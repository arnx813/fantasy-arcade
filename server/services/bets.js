// Bet lifecycle for the house originals (everything except Crash).
//
// Instant games: one transaction reserves a nonce, debits the stake, runs the engine,
// credits the payout and records the bet. Stateful games (Mines, Tower, HiLo,
// Blackjack, Video Poker) persist server-only state between actions; each action is its
// own transaction, so a crash mid-game leaves either the old or the new state, never both.
import { ENGINES } from '../../shared/games/index.js';
import { BP } from '../../shared/fair.js';
import { one, all, run, tx, afterCommit } from '../db/index.js';
import { HttpError, badRequest } from '../lib/http.js';
import { rngFor } from '../lib/fair.js';
import { config } from '../config.js';
import { adjust, balanceOf } from './wallet.js';
import { takeNonce } from './seeds.js';
import { assertCanWager } from './rg.js';
import { vipFor } from './vip.js';
import { broadcast } from './hub.js';

const engineFor = (game) => {
  const e = ENGINES[game];
  if (!e) throw new HttpError(404, 'Unknown game', 'unknown_game');
  return e;
};

const wrap = (fn) => {
  try {
    return fn();
  } catch (e) {
    if (e.userFacing) throw badRequest(e.message, 'invalid_bet');
    throw e;
  }
};

function checkAmount(amount) {
  if (!Number.isInteger(amount) || amount < 0) throw badRequest('Invalid amount');
  if (amount > 0 && amount < config.minBet) throw badRequest('Below minimum bet');
  if (amount > config.maxBet) throw badRequest('Above maximum bet', 'max_bet');
}

function checkMaxProfit(amount, payoutIfWin) {
  if (payoutIfWin - amount > config.maxProfit)
    throw new HttpError(400, 'Potential profit exceeds the table maximum', 'max_profit', { maxProfit: config.maxProfit });
}

// VIP volume, rakeback and affiliate commission all accrue on theoretical house edge.
export function accrueWager(user, amount, edge) {
  if (amount <= 0) return;
  const theo = amount * edge;
  const rate = vipFor(user.wagered).rakeback;
  run('UPDATE users SET wagered = wagered + ?, rakeback_accrued = rakeback_accrued + ? WHERE id = ?', amount, Math.floor(theo * rate), user.id);
  if (user.referred_by) {
    const c = Math.floor(theo * config.affiliateShare);
    if (c > 0) run('UPDATE users SET affiliate_accrued = affiliate_accrued + ?, affiliate_lifetime = affiliate_lifetime + ? WHERE id = ?', c, c, user.referred_by);
  }
}

export function publishBet(user, game, amount, payout) {
  const multiplier = amount > 0 ? payout / amount : 0;
  afterCommit(() =>
    broadcast({ t: 'bet', bet: { game, user: user.hidden ? null : user.username, amount, payout, multiplier, at: Date.now() } }),
  );
}

function settleRow(betId, user, game, amount, payout, outcome, edge) {
  if (payout > 0) adjust(user.id, payout, 'payout', `bet:${betId}`);
  run("UPDATE bets SET payout = ?, multiplier = ?, outcome = ?, state = NULL, status = 'settled', settled_at = ? WHERE id = ?",
    payout, amount > 0 ? payout / amount : 0, JSON.stringify(outcome), Date.now(), betId);
  publishBet(user, game, amount, payout);
}

// ---------------- instant ----------------
export function playInstant(user, game, rawAmount, rawParams) {
  const e = engineFor(game);
  if (e.kind !== 'instant') throw badRequest('Not an instant game');
  const params = wrap(() => e.validate(rawParams || {}));
  const amount = e.wager ? e.wager(params) : Number(rawAmount);
  checkAmount(amount);
  const maxPayout = e.maxPayout ? e.maxPayout(params) : Math.floor((amount * Math.floor(e.maxMultiplier(params) * BP)) / BP);
  checkMaxProfit(amount, maxPayout);
  assertCanWager(user, amount);

  return tx(() => {
    const { seed, nonce } = takeNonce(user.id);
    const r = run("INSERT INTO bets (user_id, game, amount, base_amount, seed_id, nonce, params, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)",
      user.id, game, amount, amount, seed.id, nonce, JSON.stringify(params), Date.now());
    const betId = Number(r.lastInsertRowid);
    adjust(user.id, -amount, 'bet', `bet:${betId}`);
    const res = e.play(rngFor(seed.server_seed, seed.client_seed, nonce), params, amount);
    const payout = res.payout ?? Math.floor((amount * res.multBp) / BP);
    settleRow(betId, user, game, amount, payout, res.outcome, e.edge);
    accrueWager(user, amount, e.edge);
    return { id: betId, game, amount, payout, multiplier: amount > 0 ? payout / amount : 0, nonce, clientSeed: seed.client_seed, outcome: res.outcome, balance: balanceOf(user.id) };
  });
}

// ---------------- stateful ----------------
function loadActive(userId, game) {
  return one("SELECT * FROM bets WHERE user_id = ? AND game = ? AND status = 'active'", userId, game);
}
const viewOf = (e, bet, state) => ({
  id: bet.id, game: bet.game, amount: bet.amount, baseAmount: bet.base_amount, nonce: bet.nonce,
  status: state.done ? 'settled' : 'active', state: e.view(state),
});

export function startGame(user, game, rawAmount, rawParams) {
  const e = engineFor(game);
  if (e.kind !== 'stateful') throw badRequest('Not a multi-step game');
  const params = wrap(() => e.validate(rawParams || {}));
  const amount = Number(rawAmount);
  checkAmount(amount);
  if (e.maxMultiplier) checkMaxProfit(amount, Math.floor(amount * e.maxMultiplier(params)));
  assertCanWager(user, amount);

  return tx(() => {
    if (loadActive(user.id, game)) throw badRequest('You already have a game in progress', 'active_game');
    const { seed, nonce } = takeNonce(user.id);
    const state = e.start(rngFor(seed.server_seed, seed.client_seed, nonce), params);
    const r = run("INSERT INTO bets (user_id, game, amount, base_amount, seed_id, nonce, params, state, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)",
      user.id, game, amount, amount, seed.id, nonce, JSON.stringify(params), JSON.stringify(state), Date.now());
    const bet = { id: Number(r.lastInsertRowid), game, amount, base_amount: amount, nonce };
    adjust(user.id, -amount, 'bet', `bet:${bet.id}`);
    accrueWager(user, amount, e.edge);
    if (state.done) finishStateful(user, e, bet, state);
    return { ...viewOf(e, bet, state), ...result(bet, state), balance: balanceOf(user.id) };
  });
}

export function actGame(user, game, action, data) {
  const e = engineFor(game);
  return tx(() => {
    const row = loadActive(user.id, game);
    if (!row) throw badRequest('No game in progress', 'no_active_game');
    const state = JSON.parse(row.state);
    const seed = one('SELECT * FROM seeds WHERE id = ?', row.seed_id);
    if (e.nextBp) {
      const next = e.nextBp(state, action, data || {});
      if (next && Math.floor((row.base_amount * next) / BP) - row.amount > config.maxProfit)
        throw new HttpError(400, 'This step would exceed the table maximum profit; cash out instead', 'max_profit');
    }
    const { extraUnits } = wrap(() => e.act(rngFor(seed.server_seed, seed.client_seed, row.nonce), state, action, data || {}));
    const bet = { id: row.id, game, amount: row.amount, base_amount: row.base_amount, nonce: row.nonce };
    if (extraUnits > 0) {
      const extra = extraUnits * row.base_amount;
      assertCanWager(user, extra);
      adjust(user.id, -extra, 'bet', `bet:${row.id}`);
      accrueWager(user, extra, e.edge);
      bet.amount += extra;
      run('UPDATE bets SET amount = ? WHERE id = ?', bet.amount, row.id);
    }
    if (state.done) finishStateful(user, e, bet, state);
    else run('UPDATE bets SET state = ? WHERE id = ?', JSON.stringify(state), row.id);
    return { ...viewOf(e, bet, state), ...result(bet, state), balance: balanceOf(user.id) };
  });
}

function result(bet, state) {
  if (!state.done) return {};
  const payout = Math.floor((bet.base_amount * state.multBp) / BP);
  return { payout, multiplier: bet.amount > 0 ? payout / bet.amount : state.multBp / BP / (state.wagerUnits || 1) };
}

function finishStateful(user, e, bet, state) {
  const payout = Math.floor((bet.base_amount * state.multBp) / BP);
  settleRow(bet.id, user, bet.game, bet.amount, payout, e.view(state), e.edge);
}

export function activeGame(user, game) {
  const e = engineFor(game);
  const row = loadActive(user.id, game);
  if (!row) return null;
  return viewOf(e, row, JSON.parse(row.state));
}

// ---------------- history ----------------
export function betHistory(userId, { game, limit = 50, before } = {}) {
  const rows = all(
    `SELECT id, game, amount, payout, multiplier, nonce, params, outcome, status, created_at FROM bets
     WHERE user_id = ? ${game ? 'AND game = ?' : ''} ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
    ...[userId, game, before, Math.min(Number(limit) || 50, 200)].filter((x) => x !== undefined),
  );
  return rows.map((r) => ({ ...r, params: JSON.parse(r.params), outcome: r.outcome ? JSON.parse(r.outcome) : null }));
}

export function betDetail(id) {
  const r = one(`SELECT b.*, s.client_seed, s.server_seed_hash, s.status AS seed_status, s.server_seed, u.username, u.hidden
                 FROM bets b JOIN users u ON u.id = b.user_id LEFT JOIN seeds s ON s.id = b.seed_id WHERE b.id = ?`, id);
  if (!r) return null;
  return {
    id: r.id, game: r.game, user: r.hidden ? null : r.username, amount: r.amount, payout: r.payout, multiplier: r.multiplier,
    status: r.status, createdAt: r.created_at, params: JSON.parse(r.params), outcome: r.outcome ? JSON.parse(r.outcome) : null,
    fairness: r.seed_id
      ? { clientSeed: r.client_seed, serverSeedHash: r.server_seed_hash, nonce: r.nonce, serverSeed: r.seed_status === 'revealed' ? r.server_seed : null }
      : null,
  };
}
