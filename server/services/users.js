import { randomBytes } from 'node:crypto';
import { one, run, tx } from '../db/index.js';
import { config, USD } from '../config.js';
import { HttpError, badRequest } from '../lib/http.js';
import { hashPassword, verifyPassword, newToken, tokenHash } from '../lib/auth.js';
import { ensureSeeds, publicSeeds } from './seeds.js';
import { balanceOf, adjust } from './wallet.js';
import { vipFor } from './vip.js';
import { applyPendingLimits, last24h } from './rg.js';

const DAY = 86_400_000;

export function register({ username, email, password, referral }, { country } = {}) {
  username = String(username || '').trim();
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw badRequest('Username must be 3-16 letters, numbers or _');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw badRequest('Invalid email');
  if (password.length < 8 || password.length > 200) throw badRequest('Password must be at least 8 characters');
  return tx(() => {
    if (one('SELECT id FROM users WHERE username = ?', username)) throw badRequest('Username taken', 'username_taken');
    if (one('SELECT id FROM users WHERE email = ?', email)) throw badRequest('Email already registered', 'email_taken');
    const referrer = referral ? one('SELECT id FROM users WHERE referral_code = ?', String(referral).toLowerCase()) : null;
    const role = config.adminEmails.includes(email) ? 'admin' : 'user';
    const code = username.toLowerCase();
    const referralCode = one('SELECT id FROM users WHERE referral_code = ?', code) ? `${code}${randomBytes(2).toString('hex')}` : code;
    const id = Number(run('INSERT INTO users (username, email, password_hash, role, referral_code, referred_by, country, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      username, email, hashPassword(password), role, referralCode, referrer?.id ?? null, country ?? null, Date.now()).lastInsertRowid);
    run('INSERT INTO balances (user_id, balance) VALUES (?, 0)', id);
    ensureSeeds(id);
    return one('SELECT * FROM users WHERE id = ?', id);
  });
}

export function login({ login, password }) {
  const u = one('SELECT * FROM users WHERE username = ? OR email = ?', String(login || ''), String(login || '').toLowerCase());
  // Verify against a dummy hash on a miss so timing does not reveal which accounts exist.
  const ok = verifyPassword(String(password || ''), u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'Wrong username or password', 'bad_credentials');
  if (u.banned) throw new HttpError(403, 'Account suspended', 'banned');
  return u;
}
const DUMMY_HASH = hashPassword('not-a-real-password');

export function createSession(userId, { ip, userAgent } = {}) {
  const token = newToken();
  const now = Date.now();
  run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    tokenHash(token), userId, now, now + config.sessionDays * DAY, ip ?? null, (userAgent ?? '').slice(0, 200));
  return token;
}
export function userForToken(token) {
  if (!token) return null;
  const s = one('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', tokenHash(token));
  if (!s || s.expires_at < Date.now()) return null;
  return one('SELECT * FROM users WHERE id = ?', s.user_id);
}
export const destroySession = (token) => run('DELETE FROM sessions WHERE token_hash = ?', tokenHash(token || ''));

export function me(user) {
  user = applyPendingLimits(user);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    balance: balanceOf(user.id),
    vip: vipFor(user.wagered),
    wagered: user.wagered,
    rakeback: user.rakeback_accrued,
    referralCode: user.referral_code,
    hidden: !!user.hidden,
    kycStatus: user.kyc_status,
    selfExcludedUntil: user.self_excluded_until || null,
    limits: {
      lossLimitDaily: user.loss_limit_daily,
      wagerLimitDaily: user.wager_limit_daily,
      pending: user.pending_limits ? JSON.parse(user.pending_limits) : null,
      usage: last24h(user.id),
    },
    seeds: publicSeeds(user.id),
    createdAt: user.created_at,
  };
}

export function changePassword(user, { current, next }) {
  if (!verifyPassword(String(current || ''), user.password_hash)) throw new HttpError(401, 'Current password is wrong', 'bad_credentials');
  if (String(next || '').length < 8) throw badRequest('Password must be at least 8 characters');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), user.id);
  run('DELETE FROM sessions WHERE user_id = ?', user.id);
}

// Lowering a limit applies now; raising or removing one waits 24h (cooling-off).
export function setLimits(user, { lossLimitDaily, wagerLimitDaily }) {
  const norm = (v) => (v === null || v === '' || v === undefined ? null : Math.max(0, Math.floor(Number(v))));
  const next = { loss_limit_daily: norm(lossLimitDaily), wager_limit_daily: norm(wagerLimitDaily) };
  const looser = (cur, nv) => cur !== null && (nv === null || nv > cur);
  if (looser(user.loss_limit_daily, next.loss_limit_daily) || looser(user.wager_limit_daily, next.wager_limit_daily)) {
    run('UPDATE users SET pending_limits = ? WHERE id = ?', JSON.stringify({ ...next, effective_at: Date.now() + DAY }), user.id);
    return { pending: true };
  }
  run('UPDATE users SET loss_limit_daily = ?, wager_limit_daily = ?, pending_limits = NULL WHERE id = ?', next.loss_limit_daily, next.wager_limit_daily, user.id);
  return { pending: false };
}

export function selfExclude(user, days) {
  const until = days === 'permanent' ? 8_640_000_000_000_000 : Date.now() + Math.max(1, Math.min(3650, Number(days) || 0)) * DAY;
  run('UPDATE users SET self_excluded_until = MAX(self_excluded_until, ?) WHERE id = ?', until, user.id);
  return { until };
}

export function claimRakeback(user) {
  return tx(() => {
    const u = one('SELECT rakeback_accrued FROM users WHERE id = ?', user.id);
    if (u.rakeback_accrued < USD / 100) throw badRequest('Nothing to claim yet (min $0.01)');
    run('UPDATE users SET rakeback_accrued = 0 WHERE id = ?', user.id);
    return { claimed: u.rakeback_accrued, balance: adjust(user.id, u.rakeback_accrued, 'rakeback') };
  });
}

export function affiliateSummary(user) {
  const u = one('SELECT referral_code, affiliate_accrued, affiliate_lifetime FROM users WHERE id = ?', user.id);
  const refs = one('SELECT COUNT(*) AS n, COALESCE(SUM(wagered), 0) AS w FROM users WHERE referred_by = ?', user.id);
  return { code: u.referral_code, link: `${config.publicOrigin}/?r=${u.referral_code}`, referrals: refs.n, referralWagered: refs.w, accrued: u.affiliate_accrued, lifetime: u.affiliate_lifetime, share: config.affiliateShare };
}
export function claimAffiliate(user) {
  return tx(() => {
    const u = one('SELECT affiliate_accrued FROM users WHERE id = ?', user.id);
    if (u.affiliate_accrued < USD / 100) throw badRequest('Nothing to claim yet (min $0.01)');
    run('UPDATE users SET affiliate_accrued = 0 WHERE id = ?', user.id);
    return { claimed: u.affiliate_accrued, balance: adjust(user.id, u.affiliate_accrued, 'affiliate') };
  });
}
