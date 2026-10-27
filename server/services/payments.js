// Crypto deposits and withdrawals through a pluggable gateway adapter.
//
// The platform keeps a single USD-denominated balance. The gateway quotes each
// deposit's USD value (amount_usd) in its webhook; we credit exactly that.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { one, all, run, tx } from '../db/index.js';
import { config, USD } from '../config.js';
import { HttpError, badRequest } from '../lib/http.js';
import { adjust, balanceOf } from './wallet.js';
import { toUser } from './hub.js';

export const CHAINS = [
  { id: 'BTC', name: 'Bitcoin', asset: 'BTC', confirmations: 2 },
  { id: 'ETH', name: 'Ethereum', asset: 'ETH', confirmations: 12 },
  { id: 'SOL', name: 'Solana', asset: 'SOL', confirmations: 32 },
  { id: 'LTC', name: 'Litecoin', asset: 'LTC', confirmations: 6 },
  { id: 'USDT-TRC20', name: 'Tether (Tron)', asset: 'USDT', confirmations: 20 },
  { id: 'USDT-ERC20', name: 'Tether (Ethereum)', asset: 'USDT', confirmations: 12 },
  { id: 'USDC-ERC20', name: 'USD Coin (Ethereum)', asset: 'USDC', confirmations: 12 },
];
const chainById = (id) => CHAINS.find((c) => c.id === id) || (() => { throw badRequest('Unsupported chain'); })();

// ---- adapters ----
// Each adapter implements: depositAddress(userId, chain) -> { address, memo? }
//                          sendWithdrawal({ id, chain, asset, address, amount }) -> { txHash }
// Webhooks are verified centrally (HMAC-SHA256 of the raw body, hex, header
// x-signature) and must carry the normalised deposit shape documented in README.
const adapters = {
  mock: {
    depositAddress(userId, chain) {
      const h = createHmac('sha256', 'mock-address').update(`${userId}:${chain}`).digest('hex');
      const prefix = { BTC: 'bc1q', LTC: 'ltc1q', SOL: '', 'USDT-TRC20': 'T' }[chain] ?? '0x';
      return { address: prefix + h.slice(0, chain === 'BTC' || chain === 'LTC' ? 38 : 40) };
    },
    sendWithdrawal: ({ id }) => ({ txHash: 'mock-' + createHmac('sha256', 'mock-tx').update(String(id)).digest('hex').slice(0, 48) }),
  },
  gateway: {
    // Wire your processor here (custodial gateway or your own signer). Both calls
    // must be idempotent on our ids: retries happen.
    depositAddress() {
      throw new HttpError(503, 'Deposit gateway not configured', 'gateway_unconfigured');
    },
    sendWithdrawal() {
      throw new HttpError(503, 'Withdrawal gateway not configured', 'gateway_unconfigured');
    },
  },
};
const adapter = () => adapters[config.paymentsProvider] || adapters.gateway;

export function depositAddress(userId, chain) {
  chainById(chain);
  const existing = one('SELECT address, memo FROM deposit_addresses WHERE user_id = ? AND chain = ?', userId, chain);
  if (existing) return existing;
  const a = adapter().depositAddress(userId, chain);
  run('INSERT INTO deposit_addresses (user_id, chain, address, memo) VALUES (?, ?, ?, ?)', userId, chain, a.address, a.memo ?? null);
  return { address: a.address, memo: a.memo ?? null };
}

export function verifySignature(rawBody, signature, secret = config.paymentsWebhookSecret) {
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let got;
  try { got = Buffer.from(String(signature || ''), 'hex'); } catch { return false; }
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Normalised webhook: { type: 'deposit', address, chain, asset, tx_hash, asset_amount, amount_usd, confirmed }
export function handleDepositWebhook(evt, provider = config.paymentsProvider) {
  if (evt.type !== 'deposit') return { ignored: true };
  const owner = one('SELECT user_id FROM deposit_addresses WHERE chain = ? AND address = ?', evt.chain, evt.address);
  if (!owner) throw badRequest('Unknown deposit address');
  const amount = Math.round(Number(evt.amount_usd) * USD);
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Invalid amount');
  return tx(() => {
    const existing = one('SELECT * FROM deposits WHERE provider = ? AND tx_hash = ?', provider, evt.tx_hash);
    if (existing?.status === 'credited') return { duplicate: true, id: existing.id };
    let id = existing?.id;
    if (!existing) {
      id = Number(run("INSERT INTO deposits (user_id, provider, chain, asset, tx_hash, asset_amount, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
        owner.user_id, provider, evt.chain, evt.asset, evt.tx_hash, String(evt.asset_amount), amount, Date.now()).lastInsertRowid);
    }
    if (!evt.confirmed) return { pending: true, id };
    run("UPDATE deposits SET status = 'credited', amount = ? WHERE id = ?", amount, id);
    adjust(owner.user_id, amount, 'deposit', `deposit:${id}`);
    run('UPDATE users SET deposited = deposited + ? WHERE id = ?', amount, owner.user_id);
    toUser(owner.user_id, { t: 'deposit', amount, chain: evt.chain });
    return { credited: true, id };
  });
}

export function requestWithdrawal(user, { amount, chain, address }) {
  amount = Number(amount);
  const c = chainById(chain);
  if (!Number.isInteger(amount) || amount < config.minWithdrawal) throw badRequest(`Minimum withdrawal is $${config.minWithdrawal / USD}`);
  address = String(address || '').trim();
  if (address.length < 20 || address.length > 128 || !/^[A-Za-z0-9:]+$/.test(address)) throw badRequest('Invalid address');
  if (user.banned) throw new HttpError(403, 'Account suspended', 'banned');
  if (user.wagered < user.deposited * config.withdrawRollover)
    throw badRequest(`Wager at least ${config.withdrawRollover}x your deposits before withdrawing`, 'rollover');
  if (amount >= config.kycWithdrawalThreshold && user.kyc_status !== 'verified')
    throw new HttpError(403, 'Identity verification is required for this withdrawal', 'kyc_required');
  return tx(() => {
    const id = Number(run("INSERT INTO withdrawals (user_id, amount, chain, asset, address, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
      user.id, amount, c.id, c.asset, address, Date.now(), Date.now()).lastInsertRowid);
    adjust(user.id, -amount, 'withdrawal', `withdrawal:${id}`);
    return { id, status: 'pending', balance: balanceOf(user.id) };
  });
}

export function approveWithdrawal(adminId, id) {
  const w = one('SELECT * FROM withdrawals WHERE id = ?', id);
  if (!w || w.status !== 'pending') throw badRequest('Withdrawal is not pending');
  // Claim it first so a double-click cannot send twice.
  const claimed = run("UPDATE withdrawals SET status = 'sent', reviewed_by = ?, updated_at = ? WHERE id = ? AND status = 'pending'", adminId, Date.now(), id);
  if (claimed.changes === 0) throw badRequest('Withdrawal already processed');
  try {
    const { txHash } = adapter().sendWithdrawal(w);
    run('UPDATE withdrawals SET tx_hash = ?, updated_at = ? WHERE id = ?', txHash, Date.now(), id);
    toUser(w.user_id, { t: 'withdrawal', id, status: 'sent' });
    return { id, status: 'sent', txHash };
  } catch (e) {
    run("UPDATE withdrawals SET status = 'failed', note = ?, updated_at = ? WHERE id = ?", String(e.message).slice(0, 200), Date.now(), id);
    throw e;
  }
}

export function rejectWithdrawal(adminId, id, note) {
  return tx(() => {
    const w = one('SELECT * FROM withdrawals WHERE id = ?', id);
    if (!w || !['pending', 'failed'].includes(w.status)) throw badRequest('Withdrawal cannot be rejected');
    run("UPDATE withdrawals SET status = 'rejected', note = ?, reviewed_by = ?, updated_at = ? WHERE id = ?", note || null, adminId, Date.now(), id);
    adjust(w.user_id, w.amount, 'withdrawal_refund', `withdrawal:${id}`);
    return { id, status: 'rejected' };
  });
}

export const userWithdrawals = (userId) => all('SELECT id, amount, chain, asset, address, status, tx_hash, created_at FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50', userId);
export const userDeposits = (userId) => all('SELECT id, chain, asset, asset_amount, amount, status, tx_hash, created_at FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 50', userId);
