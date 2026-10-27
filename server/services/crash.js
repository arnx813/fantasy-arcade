// Crash: one shared round at a time.
//
// Fairness: at chain creation we pick a random seed and hash it `length` times with
// SHA-256; only the terminal hash is published. Round k uses hash[length - k], so each
// revealed round hash, hashed once, equals the previous round's hash and ultimately
// the published terminal. Crash point = f(HMAC-SHA256(roundHash, salt)) (shared/crash.js).
//
// Phases: betting (bets accepted) -> running (cash out any time) -> ended (cooldown).
import { createHmac, randomBytes } from 'node:crypto';
import { one, all, run, tx, raw } from '../db/index.js';
import { sha256 } from '../lib/fair.js';
import { config } from '../config.js';
import { HttpError, badRequest } from '../lib/http.js';
import { crashFromHmacHex, crashMultiplierAt, crashTimeFor, CRASH_EDGE } from '../../shared/crash.js';
import { adjust, balanceOf } from './wallet.js';
import { accrueWager, publishBet } from './bets.js';
import { assertCanWager } from './rg.js';
import { broadcast } from './hub.js';

const TICK_MS = 100;
let round = null; // { id, hash, crashPoint, phase, bettingEndsAt, startedAt, bets: Map<betId, bet> }
let history = [];
let timer = null;

function createChain() {
  const length = config.crash.chainLength;
  let h = randomBytes(32).toString('hex');
  const db = raw();
  return tx(() => {
    const r = run('INSERT INTO crash_chain (terminal_hash, salt, length, created_at) VALUES (?, ?, ?, ?)', '', config.crash.salt, length, Date.now());
    const chainId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO crash_hashes (chain_id, idx, hash) VALUES (?, ?, ?)');
    for (let i = 0; i <= length; i++) {
      ins.run(chainId, i, h);
      if (i < length) h = sha256(h);
    }
    run('UPDATE crash_chain SET terminal_hash = ? WHERE id = ?', h, chainId);
    console.log(`[crash] new hash chain #${chainId}, terminal ${h}`);
    return chainId;
  });
}

function nextHash() {
  let chain = one('SELECT * FROM crash_chain WHERE used < length ORDER BY id DESC LIMIT 1');
  if (!chain) chain = one('SELECT * FROM crash_chain WHERE id = ?', createChain());
  const used = chain.used + 1;
  run('UPDATE crash_chain SET used = ? WHERE id = ?', used, chain.id);
  const idx = chain.length - used;
  return { chainId: chain.id, idx, hash: one('SELECT hash FROM crash_hashes WHERE chain_id = ? AND idx = ?', chain.id, idx).hash, salt: chain.salt };
}

export const crashPointFor = (hash, salt) => crashFromHmacHex(createHmac('sha256', hash).update(salt).digest('hex'), CRASH_EDGE);

function publicRound() {
  if (!round) return null;
  return {
    id: round.id,
    phase: round.phase,
    bettingEndsAt: round.bettingEndsAt,
    startedAt: round.startedAt,
    serverTime: Date.now(),
    timeScale: config.crash.timeScale,
    crashPoint: round.phase === 'ended' ? round.crashPoint : null,
    hash: round.phase === 'ended' ? round.hash : null,
    bets: [...round.bets.values()].map(publicBet),
  };
}
const publicBet = (b) => ({ id: b.id, user: b.hidden ? null : b.username, amount: b.amount, cashedOutAt: b.cashedOutAt ?? null, payout: b.payout ?? null });

// myBetId lets a client find its own bet even when the player hides their name.
export const crashState = (userId) => ({
  round: publicRound(),
  history,
  myBetId: userId && round ? ([...round.bets.values()].find((b) => b.userId === userId)?.id ?? null) : null,
});

function startBetting() {
  const { chainId, idx, hash, salt } = tx(nextHash);
  const crashPoint = crashPointFor(hash, salt);
  const r = run("INSERT INTO crash_rounds (chain_id, chain_idx, hash, crash_point, status) VALUES (?, ?, ?, ?, 'betting')", chainId, idx, hash, crashPoint);
  round = { id: Number(r.lastInsertRowid), hash, crashPoint, phase: 'betting', bettingEndsAt: Date.now() + config.crash.bettingMs, startedAt: null, bets: new Map() };
  broadcast({ t: 'crash:round', round: publicRound() });
  timer = setTimeout(startRunning, config.crash.bettingMs);
}

function startRunning() {
  round.phase = 'running';
  round.startedAt = Date.now();
  run("UPDATE crash_rounds SET status = 'running', started_at = ? WHERE id = ?", round.startedAt, round.id);
  broadcast({ t: 'crash:start', id: round.id, startedAt: round.startedAt, serverTime: Date.now() });
  timer = setInterval(tick, TICK_MS);
}

function tick() {
  const elapsed = (Date.now() - round.startedAt) * config.crash.timeScale;
  const m = crashMultiplierAt(elapsed);
  const ceiling = Math.min(m, round.crashPoint);
  // Auto cash-outs (including forced ones at the max-profit cap) pay exactly their target.
  for (const b of round.bets.values()) {
    if (b.cashedOutAt == null && b.auto && b.auto <= ceiling) cashOut(b, b.auto);
  }
  if (m >= round.crashPoint) endRound();
}

function endRound() {
  clearInterval(timer);
  round.phase = 'ended';
  tx(() => {
    run("UPDATE crash_rounds SET status = 'ended', ended_at = ? WHERE id = ?", Date.now(), round.id);
    for (const b of round.bets.values()) {
      if (b.cashedOutAt != null) continue;
      b.payout = 0;
      run("UPDATE bets SET payout = 0, multiplier = 0, outcome = ?, status = 'settled', settled_at = ? WHERE id = ?",
        JSON.stringify({ roundId: round.id, crashPoint: round.crashPoint, cashedOutAt: null }), Date.now(), b.id);
      publishBet(b.user, 'crash', b.amount, 0);
    }
  });
  history = [{ id: round.id, crashPoint: round.crashPoint, hash: round.hash }, ...history].slice(0, 30);
  broadcast({ t: 'crash:end', id: round.id, crashPoint: round.crashPoint, hash: round.hash, history });
  timer = setTimeout(startBetting, config.crash.cooldownMs);
}

function cashOut(b, at) {
  const payout = Math.floor((b.amount * Math.round(at * 100)) / 100); // integer math, no float drift
  tx(() => {
    if (payout > 0) adjust(b.userId, payout, 'payout', `bet:${b.id}`);
    run("UPDATE bets SET payout = ?, multiplier = ?, outcome = ?, status = 'settled', settled_at = ? WHERE id = ?",
      payout, at, JSON.stringify({ roundId: round.id, crashPoint: null, cashedOutAt: at }), Date.now(), b.id);
    publishBet(b.user, 'crash', b.amount, payout);
  });
  b.cashedOutAt = at;
  b.payout = payout;
  broadcast({ t: 'crash:cashout', id: round.id, bet: publicBet(b) });
}

export function placeCrashBet(user, amount, autoCashout) {
  amount = Number(amount);
  if (!Number.isInteger(amount) || amount < 0) throw badRequest('Invalid amount');
  if (amount > config.maxBet) throw badRequest('Above maximum bet', 'max_bet');
  if (amount > 0 && amount < config.minBet) throw badRequest('Below minimum bet');
  let auto = autoCashout == null || autoCashout === '' ? null : Math.floor(Number(autoCashout) * 100) / 100;
  if (auto !== null && !(auto >= 1.01)) throw badRequest('Auto cash-out must be at least 1.01x');
  // The max-profit cap becomes a forced auto cash-out.
  if (amount > 0) {
    const cap = Math.floor(((config.maxProfit + amount) / amount) * 100) / 100;
    if (auto === null || auto > cap) auto = Math.max(1.01, cap);
  }
  if (!round || round.phase !== 'betting') throw new HttpError(400, 'Betting is closed for this round', 'betting_closed');
  if ([...round.bets.values()].some((b) => b.userId === user.id)) throw badRequest('You already have a bet this round');
  assertCanWager(user, amount);
  const bet = tx(() => {
    const r = run("INSERT INTO bets (user_id, game, amount, base_amount, params, status, created_at) VALUES (?, 'crash', ?, ?, ?, 'active', ?)",
      user.id, amount, amount, JSON.stringify({ roundId: round.id, autoCashout: auto }), Date.now());
    const id = Number(r.lastInsertRowid);
    adjust(user.id, -amount, 'bet', `bet:${id}`);
    accrueWager(user, amount, CRASH_EDGE);
    return { id, userId: user.id, username: user.username, hidden: !!user.hidden, user, amount, auto };
  });
  round.bets.set(bet.id, bet);
  broadcast({ t: 'crash:bet', id: round.id, bet: publicBet(bet) });
  return { id: bet.id, roundId: round.id, amount, autoCashout: auto, balance: balanceOf(user.id) };
}

export function manualCashout(user) {
  if (!round || round.phase !== 'running') throw badRequest('No running round');
  const b = [...round.bets.values()].find((x) => x.userId === user.id);
  if (!b || b.cashedOutAt != null) throw badRequest('No active bet');
  let m = crashMultiplierAt((Date.now() - round.startedAt) * config.crash.timeScale);
  if (m >= round.crashPoint) throw badRequest('Too late', 'crashed');
  // Never pay past the bet's cap (max profit), even if a tick has not run yet.
  if (b.auto && m > b.auto) m = b.auto;
  cashOut(b, m);
  return { cashedOutAt: m, payout: b.payout, balance: balanceOf(user.id) };
}

export function verifyCrash(hash) {
  const chain = one('SELECT c.* FROM crash_rounds r JOIN crash_chain c ON c.id = r.chain_id WHERE r.hash = ?', hash);
  return { crashPoint: crashPointFor(hash, chain?.salt ?? config.crash.salt), previousHash: sha256(hash) };
}

export function startCrashLoop() {
  // Rounds interrupted by a restart are voided and their open bets refunded: players
  // could not cash out, so the predetermined crash point is not honoured.
  tx(() => {
    for (const r of all("SELECT id FROM crash_rounds WHERE status IN ('betting', 'running')")) {
      for (const b of all("SELECT * FROM bets WHERE game = 'crash' AND status = 'active' AND json_extract(params, '$.roundId') = ?", r.id)) {
        adjust(b.user_id, b.amount, 'payout', `bet:${b.id}:void`);
        run("UPDATE bets SET status = 'void', payout = amount, settled_at = ? WHERE id = ?", Date.now(), b.id);
      }
      run("UPDATE crash_rounds SET status = 'void' WHERE id = ?", r.id);
    }
  });
  history = all("SELECT id, crash_point AS crashPoint, hash FROM crash_rounds WHERE status = 'ended' ORDER BY id DESC LIMIT 30");
  startBetting();
}

export function stopCrashLoop() {
  clearTimeout(timer);
  clearInterval(timer);
}

export const crashTimes = { crashTimeFor };
