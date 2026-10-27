// Responsible-gaming gates applied before any wager.
import { one, run } from '../db/index.js';
import { HttpError } from '../lib/http.js';

const DAY = 86_400_000;
const WAGER_KINDS = "('bet', 'provider_debit')";
const PLAY_KINDS = "('bet', 'payout', 'provider_debit', 'provider_credit', 'provider_rollback')";

export function applyPendingLimits(user) {
  if (!user.pending_limits) return user;
  const p = JSON.parse(user.pending_limits);
  if (p.effective_at > Date.now()) return user;
  run('UPDATE users SET loss_limit_daily = ?, wager_limit_daily = ?, pending_limits = NULL WHERE id = ?', p.loss_limit_daily, p.wager_limit_daily, user.id);
  return { ...user, loss_limit_daily: p.loss_limit_daily, wager_limit_daily: p.wager_limit_daily, pending_limits: null };
}

export function last24h(userId) {
  const since = Date.now() - DAY;
  const wagered = -(one(`SELECT COALESCE(SUM(delta), 0) AS s FROM ledger WHERE user_id = ? AND created_at > ? AND kind IN ${WAGER_KINDS}`, userId, since).s);
  const net = one(`SELECT COALESCE(SUM(delta), 0) AS s FROM ledger WHERE user_id = ? AND created_at > ? AND kind IN ${PLAY_KINDS}`, userId, since).s;
  return { wagered, netLoss: Math.max(0, -net) };
}

export function assertCanWager(user, amount) {
  if (user.banned) throw new HttpError(403, 'Account suspended', 'banned');
  if (user.self_excluded_until > Date.now()) throw new HttpError(403, 'You are self-excluded from play', 'self_excluded');
  user = applyPendingLimits(user);
  if (user.loss_limit_daily == null && user.wager_limit_daily == null) return;
  const { wagered, netLoss } = last24h(user.id);
  if (user.wager_limit_daily != null && wagered + amount > user.wager_limit_daily)
    throw new HttpError(403, 'This bet would exceed your 24h wager limit', 'wager_limit');
  if (user.loss_limit_daily != null && netLoss + amount > user.loss_limit_daily)
    throw new HttpError(403, 'This bet could exceed your 24h loss limit', 'loss_limit');
}
