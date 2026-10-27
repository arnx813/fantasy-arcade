import { one, run, afterCommit } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { toUser } from './hub.js';

// Must be called inside db.tx(). Debits fail atomically if they would overdraw.
export function adjust(userId, delta, kind, ref = null) {
  if (!Number.isInteger(delta)) throw new Error(`non-integer delta ${delta}`);
  if (delta === 0) return balanceOf(userId);
  const r = delta < 0
    ? run('UPDATE balances SET balance = balance + ? WHERE user_id = ? AND balance >= ?', delta, userId, -delta)
    : run('UPDATE balances SET balance = balance + ? WHERE user_id = ?', delta, userId);
  if (r.changes === 0) throw new HttpError(400, 'Insufficient balance', 'insufficient_balance');
  const balance = balanceOf(userId);
  run('INSERT INTO ledger (user_id, delta, balance_after, kind, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)', userId, delta, balance, kind, ref, Date.now());
  afterCommit(() => toUser(userId, { t: 'balance', balance }));
  return balance;
}

export const balanceOf = (userId) => one('SELECT balance FROM balances WHERE user_id = ?', userId)?.balance ?? 0;
