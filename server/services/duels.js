// Coinflip duels: player vs player. The creator escrows a stake and picks a side;
// the first player to accept takes the other side and the flip settles instantly.
// The winner takes both stakes minus the house rake.
//
// Fairness: each duel gets a fresh server seed whose SHA-256 is shown from creation.
// The flip is HMAC-SHA256(serverSeed, "duelId:creatorId:joinerId"): below 0.5 is
// heads. Neither side can steer it, because the joiner is unknown when the seed is
// committed and the seed is fixed before anyone joins. The seed is revealed after.
import { createHmac, randomBytes } from 'node:crypto';
import { one, all, run, tx } from '../db/index.js';
import { sha256 } from '../lib/fair.js';
import { config } from '../config.js';
import { HttpError, badRequest } from '../lib/http.js';
import { adjust, balanceOf } from './wallet.js';
import { accrueWager, publishBet } from './bets.js';
import { assertCanWager } from './rg.js';
import { broadcast } from './hub.js';

const MAX_OPEN_PER_USER = 5;

export function duelFlip(serverSeed, duelId, creatorId, joinerId) {
  const hex = createHmac('sha256', serverSeed).update(`${duelId}:${creatorId}:${joinerId}`).digest('hex');
  return parseInt(hex.slice(0, 13), 16) / 2 ** 52 < 0.5 ? 'heads' : 'tails';
}

const SELECT = `SELECT d.*, c.username AS creator, c.hidden AS creator_hidden, j.username AS joiner, j.hidden AS joiner_hidden
                FROM duels d JOIN users c ON c.id = d.creator_id LEFT JOIN users j ON j.id = d.joiner_id`;
export function publicDuel(d) {
  return {
    id: d.id, amount: d.amount, creatorSide: d.creator_side, status: d.status, seedHash: d.seed_hash,
    creator: d.creator_hidden ? null : d.creator, creatorId: d.creator_id,
    joiner: d.joiner_id ? (d.joiner_hidden ? null : d.joiner) : null, joinerId: d.joiner_id,
    result: d.result, winnerId: d.winner_id, payout: d.payout,
    serverSeed: d.status === 'done' ? d.server_seed : null,
    createdAt: d.created_at, settledAt: d.settled_at,
  };
}
const load = (id) => one(`${SELECT} WHERE d.id = ?`, id);

export function createDuel(user, amount, side) {
  amount = Number(amount);
  if (!['heads', 'tails'].includes(side)) throw badRequest('Pick heads or tails');
  if (!Number.isInteger(amount) || amount < config.pvpMinBet) throw badRequest(`Minimum stake is $${(config.pvpMinBet / 1e6).toFixed(2)}`);
  if (amount > config.maxBet) throw badRequest('Above maximum bet', 'max_bet');
  assertCanWager(user, amount);
  const id = tx(() => {
    const open = one("SELECT COUNT(*) AS n FROM duels WHERE creator_id = ? AND status = 'open'", user.id).n;
    if (open >= MAX_OPEN_PER_USER) throw badRequest(`You can have ${MAX_OPEN_PER_USER} open duels at a time`);
    const seed = randomBytes(32).toString('hex');
    const duelId = Number(run("INSERT INTO duels (creator_id, amount, creator_side, server_seed, seed_hash, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)",
      user.id, amount, side, seed, sha256(seed), Date.now()).lastInsertRowid);
    const betId = Number(run("INSERT INTO bets (user_id, game, amount, base_amount, params, status, created_at) VALUES (?, 'duel', ?, ?, ?, 'active', ?)",
      user.id, amount, amount, JSON.stringify({ duelId, side }), Date.now()).lastInsertRowid);
    run('UPDATE duels SET creator_bet_id = ? WHERE id = ?', betId, duelId);
    adjust(user.id, -amount, 'bet', `bet:${betId}`);
    accrueWager(user, amount, config.duelRake);
    return duelId;
  });
  const duel = publicDuel(load(id));
  broadcast({ t: 'duel:open', duel });
  return { duel, balance: balanceOf(user.id) };
}

export function joinDuel(user, id) {
  const d0 = load(id);
  if (!d0) throw new HttpError(404, 'Duel not found', 'not_found');
  if (d0.creator_id === user.id) throw badRequest('You cannot take your own duel');
  assertCanWager(user, d0.amount);
  const creator = one('SELECT * FROM users WHERE id = ?', d0.creator_id);
  tx(() => {
    // Claim the duel atomically; a second joiner finds it no longer open.
    const claimed = run("UPDATE duels SET joiner_id = ?, status = 'done', settled_at = ? WHERE id = ? AND status = 'open'", user.id, Date.now(), id);
    if (claimed.changes === 0) throw badRequest('Someone else took this duel', 'duel_taken');
    const side = d0.creator_side === 'heads' ? 'tails' : 'heads';
    const joinerBet = Number(run("INSERT INTO bets (user_id, game, amount, base_amount, params, status, created_at) VALUES (?, 'duel', ?, ?, ?, 'active', ?)",
      user.id, d0.amount, d0.amount, JSON.stringify({ duelId: id, side }), Date.now()).lastInsertRowid);
    adjust(user.id, -d0.amount, 'bet', `bet:${joinerBet}`);
    accrueWager(user, d0.amount, config.duelRake);
    const result = duelFlip(d0.server_seed, id, d0.creator_id, user.id);
    const winnerId = result === d0.creator_side ? d0.creator_id : user.id;
    const payout = Math.floor(2 * d0.amount * (1 - config.duelRake));
    run('UPDATE duels SET joiner_bet_id = ?, result = ?, winner_id = ?, payout = ? WHERE id = ?', joinerBet, result, winnerId, payout, id);
    for (const [uid, betId, u] of [[d0.creator_id, d0.creator_bet_id, creator], [user.id, joinerBet, user]]) {
      const won = uid === winnerId;
      if (won) adjust(uid, payout, 'payout', `bet:${betId}`);
      run("UPDATE bets SET payout = ?, multiplier = ?, outcome = ?, status = 'settled', settled_at = ? WHERE id = ?",
        won ? payout : 0, won ? payout / d0.amount : 0, JSON.stringify({ duelId: id, result, won }), Date.now(), betId);
      publishBet(u, 'duel', d0.amount, won ? payout : 0);
    }
  });
  const duel = publicDuel(load(id));
  broadcast({ t: 'duel:result', duel });
  return { duel, balance: balanceOf(user.id) };
}

export function cancelDuel(user, id) {
  tx(() => {
    const d = one('SELECT * FROM duels WHERE id = ?', id);
    if (!d || d.creator_id !== user.id) throw new HttpError(404, 'Duel not found', 'not_found');
    const r = run("UPDATE duels SET status = 'cancelled', settled_at = ? WHERE id = ? AND status = 'open'", Date.now(), id);
    if (r.changes === 0) throw badRequest('This duel was already taken');
    adjust(user.id, d.amount, 'payout', `bet:${d.creator_bet_id}:void`);
    run("UPDATE bets SET status = 'void', payout = amount, settled_at = ? WHERE id = ?", Date.now(), d.creator_bet_id);
  });
  broadcast({ t: 'duel:cancel', id });
  return { ok: true, balance: balanceOf(user.id) };
}

export const openDuels = () => all(`${SELECT} WHERE d.status = 'open' ORDER BY d.amount DESC, d.id DESC LIMIT 60`).map(publicDuel);
export const recentDuels = () => all(`${SELECT} WHERE d.status = 'done' ORDER BY d.settled_at DESC LIMIT 20`).map(publicDuel);
export const duelById = (id) => { const d = load(id); return d ? publicDuel(d) : null; };
