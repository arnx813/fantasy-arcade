// Jackpot: a shared pot, one winner drawn weighted by stake. Player vs player; the
// house takes a rake from the pot.
//
// Fairness: each round gets a fresh server seed whose SHA-256 is published when the
// round opens. When the countdown ends, the entry list is frozen and hashed (digest);
// the winning ticket is HMAC-SHA256(serverSeed, "roundId:digest") as a float in [0, 1)
// times the pot, and the winner is whoever's cumulative stake range contains it.
// The seed is revealed with the result, so anyone can recompute the draw.
//
// Lifecycle: open (waiting for a second player) -> countdown -> drawing (result known,
// clients animate the spin) -> ended -> next round.
import { createHmac, randomBytes } from 'node:crypto';
import { one, all, run, tx } from '../db/index.js';
import { sha256 } from '../lib/fair.js';
import { config } from '../config.js';
import { HttpError, badRequest } from '../lib/http.js';
import { adjust, balanceOf } from './wallet.js';
import { accrueWager, publishBet } from './bets.js';
import { assertCanWager } from './rg.js';
import { broadcast } from './hub.js';

const MAX_ENTRIES = 200;
const COOLDOWN_MS = 4000;
let round = null;
let history = [];
let timer = null;

export function jackpotDigest(entries) {
  return sha256(JSON.stringify(entries.map((e) => [e.userId, e.amount])));
}
// Pure draw, shared with the verifier: returns { ticket, winnerIndex }.
export function jackpotDraw(serverSeed, roundId, entries) {
  const pot = entries.reduce((a, e) => a + e.amount, 0);
  const hex = createHmac('sha256', serverSeed).update(`${roundId}:${jackpotDigest(entries)}`).digest('hex');
  const ticket = Math.floor((parseInt(hex.slice(0, 13), 16) / 2 ** 52) * pot);
  let acc = 0;
  for (let i = 0; i < entries.length; i++) {
    acc += entries[i].amount;
    if (ticket < acc) return { ticket, winnerIndex: i };
  }
  return { ticket, winnerIndex: entries.length - 1 };
}

const players = () => {
  const m = new Map();
  for (const e of round.entries) {
    const p = m.get(e.userId) || { userId: e.userId, user: e.hidden ? null : e.username, amount: 0 };
    p.amount += e.amount;
    m.set(e.userId, p);
  }
  return [...m.values()];
};

function publicRound() {
  if (!round) return null;
  return {
    id: round.id,
    status: round.status,
    seedHash: round.seedHash,
    pot: round.pot,
    endsAt: round.endsAt,
    serverTime: Date.now(),
    players: players(),
    entries: round.entries.map((e) => ({ user: e.hidden ? null : e.username, userId: e.userId, amount: e.amount })),
    result: round.result || null,
  };
}
export const jackpotState = () => ({ round: publicRound(), history });

function openRound() {
  const serverSeed = randomBytes(32).toString('hex');
  const seedHash = sha256(serverSeed);
  const id = Number(run("INSERT INTO pvp_rounds (game, server_seed, seed_hash, status, created_at) VALUES ('jackpot', ?, ?, 'open', ?)", serverSeed, seedHash, Date.now()).lastInsertRowid);
  round = { id, serverSeed, seedHash, status: 'open', pot: 0, endsAt: null, entries: [], betIds: new Map(), result: null };
  broadcast({ t: 'jackpot:round', round: publicRound() });
}

export function placeJackpotEntry(user, amount) {
  amount = Number(amount);
  if (!Number.isInteger(amount) || amount < config.pvpMinBet) throw badRequest(`Minimum entry is $${(config.pvpMinBet / 1e6).toFixed(2)}`);
  if (amount > config.maxBet) throw badRequest('Above maximum bet', 'max_bet');
  if (!round || !['open', 'countdown'].includes(round.status)) throw new HttpError(400, 'This round is closed. The next one opens in a moment', 'round_closed');
  if (round.entries.length >= MAX_ENTRIES) throw badRequest('This round is full');
  assertCanWager(user, amount);
  const r = round;
  const betId = tx(() => {
    let id = r.betIds.get(user.id);
    if (id) {
      run('UPDATE bets SET amount = amount + ?, base_amount = base_amount + ? WHERE id = ?', amount, amount, id);
    } else {
      id = Number(run("INSERT INTO bets (user_id, game, amount, base_amount, params, status, created_at) VALUES (?, 'jackpot', ?, ?, ?, 'active', ?)",
        user.id, amount, amount, JSON.stringify({ roundId: r.id }), Date.now()).lastInsertRowid);
    }
    adjust(user.id, -amount, 'bet', `bet:${id}`);
    run('INSERT INTO pvp_entries (round_id, user_id, amount, created_at) VALUES (?, ?, ?, ?)', r.id, user.id, amount, Date.now());
    run('UPDATE pvp_rounds SET pot = pot + ? WHERE id = ?', amount, r.id);
    accrueWager(user, amount, config.jackpotRake);
    return id;
  });
  r.betIds.set(user.id, betId);
  r.entries.push({ userId: user.id, username: user.username, hidden: !!user.hidden, user, amount });
  r.pot += amount;
  if (r.status === 'open' && players().length >= 2) {
    r.status = 'countdown';
    r.endsAt = Date.now() + config.jackpotCountdownMs;
    run("UPDATE pvp_rounds SET status = 'countdown', ends_at = ? WHERE id = ?", r.endsAt, r.id);
    timer = setTimeout(draw, config.jackpotCountdownMs);
  }
  broadcast({ t: 'jackpot:entry', round: publicRound() });
  return { roundId: r.id, betId, balance: balanceOf(user.id) };
}

function draw() {
  const r = round;
  r.status = 'drawing';
  const entries = r.entries.map((e) => ({ userId: e.userId, amount: e.amount }));
  const digest = jackpotDigest(entries);
  const { ticket, winnerIndex } = jackpotDraw(r.serverSeed, r.id, entries);
  const winner = r.entries[winnerIndex];
  const rake = Math.floor(r.pot * config.jackpotRake);
  const payout = r.pot - rake;
  tx(() => {
    run("UPDATE pvp_rounds SET status = 'ended', winner_id = ?, ticket = ?, entries_digest = ?, rake = ?, ended_at = ? WHERE id = ?",
      winner.userId, ticket, digest, rake, Date.now(), r.id);
    for (const [userId, betId] of r.betIds) {
      const won = userId === winner.userId;
      const bet = one('SELECT amount FROM bets WHERE id = ?', betId);
      const pay = won ? payout : 0;
      if (won) adjust(userId, payout, 'payout', `bet:${betId}`);
      run("UPDATE bets SET payout = ?, multiplier = ?, outcome = ?, status = 'settled', settled_at = ? WHERE id = ?",
        pay, bet.amount > 0 ? pay / bet.amount : 0, JSON.stringify({ roundId: r.id, won, pot: r.pot, ticket }), Date.now(), betId);
      const entry = r.entries.find((e) => e.userId === userId);
      publishBet(entry.user, 'jackpot', bet.amount, pay);
    }
  });
  const winnerStake = players().find((p) => p.userId === winner.userId).amount;
  r.result = {
    winnerId: winner.userId, winner: winner.hidden ? null : winner.username, ticket, digest, serverSeed: r.serverSeed,
    payout, rake, chance: winnerStake / r.pot,
  };
  broadcast({ t: 'jackpot:draw', round: publicRound(), spinMs: config.jackpotSpinMs });
  timer = setTimeout(() => {
    r.status = 'ended';
    history = [{ id: r.id, pot: r.pot, winner: r.result.winner, chance: r.result.chance, payout }, ...history].slice(0, 20);
    broadcast({ t: 'jackpot:ended', id: r.id, history });
    timer = setTimeout(openRound, COOLDOWN_MS);
  }, config.jackpotSpinMs);
}

// Full record of a finished round for the verifier.
export function jackpotRound(id) {
  const r = one('SELECT * FROM pvp_rounds WHERE id = ?', id);
  if (!r) return null;
  const done = r.status === 'ended';
  const entries = all(`SELECT e.user_id AS userId, e.amount, CASE WHEN u.hidden THEN NULL ELSE u.username END AS user
                       FROM pvp_entries e JOIN users u ON u.id = e.user_id WHERE e.round_id = ? ORDER BY e.id`, id);
  const w = r.winner_id ? one('SELECT username, hidden FROM users WHERE id = ?', r.winner_id) : null;
  return {
    id: r.id, status: r.status, pot: r.pot, rake: r.rake, seedHash: r.seed_hash, serverSeed: done ? r.server_seed : null,
    digest: r.entries_digest, ticket: r.ticket, winner: w && !w.hidden ? w.username : null, entries, createdAt: r.created_at, endedAt: r.ended_at,
  };
}

export function startJackpotLoop() {
  // Rounds cut off by a restart are voided; every stake is refunded.
  tx(() => {
    for (const r of all("SELECT id FROM pvp_rounds WHERE status IN ('open', 'countdown', 'drawing')")) {
      for (const b of all("SELECT * FROM bets WHERE game = 'jackpot' AND status = 'active' AND json_extract(params, '$.roundId') = ?", r.id)) {
        adjust(b.user_id, b.amount, 'payout', `bet:${b.id}:void`);
        run("UPDATE bets SET status = 'void', payout = amount, settled_at = ? WHERE id = ?", Date.now(), b.id);
      }
      run("UPDATE pvp_rounds SET status = 'void' WHERE id = ?", r.id);
    }
  });
  history = all(`SELECT r.id, r.pot, r.pot - r.rake AS payout, CASE WHEN u.hidden THEN NULL ELSE u.username END AS winner
                 FROM pvp_rounds r LEFT JOIN users u ON u.id = r.winner_id WHERE r.status = 'ended' ORDER BY r.id DESC LIMIT 20`);
  openRound();
}
export function stopJackpotLoop() {
  clearTimeout(timer);
}
