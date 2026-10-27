import { Router, HttpError, badRequest, forbidden, notFound, cookie, rateLimiter } from '../lib/http.js';
import { config, USD } from '../config.js';
import { one, all, run, tx } from '../db/index.js';
import { CATALOG, ENGINES } from '../../shared/games/index.js';
import * as users from '../services/users.js';
import * as bets from '../services/bets.js';
import * as seeds from '../services/seeds.js';
import * as crash from '../services/crash.js';
import * as pay from '../services/payments.js';
import * as agg from '../services/aggregator.js';
import { recentChat, deleteChat } from '../services/chat.js';
import { VIP_LEVELS } from '../services/vip.js';
import { adjust } from '../services/wallet.js';
import { onlineCount } from '../services/hub.js';
import { registerArena } from './arena.js';

export const api = new Router();

const RL = Number(process.env.RATE_LIMIT_SCALE || 1); // tests raise this
const authLimit = rateLimiter({ capacity: 10 * RL, refillPerSec: 0.2 * RL });
const betLimit = rateLimiter({ capacity: 30 * RL, refillPerSec: 15 * RL });

// ---------- middleware ----------
const requireUser = (ctx) => {
  if (!ctx.user) throw new HttpError(401, 'Sign in to continue', 'unauthenticated');
};
const requireAdmin = (ctx) => {
  requireUser(ctx);
  if (ctx.user.role !== 'admin') throw forbidden();
};
const geo = (ctx) => {
  if (ctx.country && config.blockedCountries.includes(ctx.country))
    throw new HttpError(451, 'Fantasy Arcade is not available in your region', 'geo_blocked');
};
const betGate = (ctx) => {
  requireUser(ctx);
  geo(ctx);
  betLimit(`u${ctx.user.id}`);
};
const sessionCookie = (token, maxAgeDays = config.sessionDays) =>
  cookie('fa_sid', token, { maxAge: maxAgeDays * 86400, secure: config.isProd });

// ---------- auth ----------
api.post('/api/auth/register', (ctx) => {
  authLimit(`r${ctx.ip}`);
  geo(ctx);
  const user = users.register(ctx.body, { country: ctx.country });
  ctx.setCookie(sessionCookie(users.createSession(user.id, ctx.meta)));
  return users.me(user);
});
api.post('/api/auth/login', (ctx) => {
  authLimit(`l${ctx.ip}`);
  const user = users.login(ctx.body);
  ctx.setCookie(sessionCookie(users.createSession(user.id, ctx.meta)));
  return users.me(user);
});
api.post('/api/auth/logout', (ctx) => {
  users.destroySession(ctx.token);
  ctx.setCookie(sessionCookie('', 0));
  return { ok: true };
});

// ---------- me ----------
api.get('/api/me', requireUser, (ctx) => users.me(ctx.user));
api.post('/api/me/settings', requireUser, (ctx) => {
  run('UPDATE users SET hidden = ? WHERE id = ?', ctx.body.hidden ? 1 : 0, ctx.user.id);
  return { ok: true };
});
api.post('/api/me/password', requireUser, (ctx) => {
  users.changePassword(ctx.user, ctx.body);
  ctx.setCookie(sessionCookie(users.createSession(ctx.user.id, ctx.meta)));
  return { ok: true };
});
api.post('/api/me/limits', requireUser, (ctx) => users.setLimits(ctx.user, ctx.body));
api.post('/api/me/self-exclude', requireUser, (ctx) => users.selfExclude(ctx.user, ctx.body.days));
api.get('/api/me/transactions', requireUser, (ctx) =>
  all('SELECT id, delta, balance_after, kind, ref, created_at FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 100', ctx.user.id),
);
api.get('/api/me/bets', requireUser, (ctx) => bets.betHistory(ctx.user.id, { game: ctx.query.game, before: ctx.query.before ? Number(ctx.query.before) : undefined }));

// ---------- rewards ----------
api.get('/api/vip', (ctx) => ({ levels: VIP_LEVELS, me: ctx.user ? users.me(ctx.user).vip : null }));
api.post('/api/rewards/rakeback/claim', requireUser, (ctx) => users.claimRakeback(ctx.user));
api.get('/api/affiliate', requireUser, (ctx) => users.affiliateSummary(ctx.user));
api.post('/api/affiliate/claim', requireUser, (ctx) => users.claimAffiliate(ctx.user));

// ---------- casino ----------
api.get('/api/games', () => ({ originals: CATALOG, providers: agg.providerCatalog() }));
api.post('/api/games/:game/bet', betGate, (ctx) => bets.playInstant(ctx.user, ctx.params.game, ctx.body.amount, ctx.body.params));
api.post('/api/games/:game/start', betGate, (ctx) => bets.startGame(ctx.user, ctx.params.game, ctx.body.amount, ctx.body.params));
api.post('/api/games/:game/action', betGate, (ctx) => bets.actGame(ctx.user, ctx.params.game, ctx.body.action, ctx.body.data));
api.get('/api/games/:game/active', requireUser, (ctx) => ({ active: bets.activeGame(ctx.user, ctx.params.game) }));
api.get('/api/bets/:id', (ctx) => bets.betDetail(Number(ctx.params.id)) ?? (() => { throw notFound(); })());
api.post('/api/casino/launch', requireUser, (ctx) => {
  geo(ctx);
  return agg.launch(ctx.user, String(ctx.body.gameId));
});

// ---------- fairness ----------
api.get('/api/fair/seeds', requireUser, (ctx) => seeds.publicSeeds(ctx.user.id));
api.post('/api/fair/rotate', requireUser, (ctx) => seeds.rotate(ctx.user.id, ctx.body.clientSeed));
api.get('/api/fair/revealed', requireUser, (ctx) =>
  all("SELECT server_seed, server_seed_hash, client_seed, nonce, created_at, revealed_at FROM seeds WHERE user_id = ? AND status = 'revealed' ORDER BY id DESC LIMIT 50", ctx.user.id),
);
api.get('/api/crash/verify', (ctx) => {
  const hash = String(ctx.query.hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) throw badRequest('hash must be 64 hex chars');
  return crash.verifyCrash(hash);
});
api.get('/api/crash/chain', () => all('SELECT id, terminal_hash, salt, length, used, created_at FROM crash_chain ORDER BY id DESC'));

// ---------- crash ----------
api.get('/api/crash/state', (ctx) => crash.crashState(ctx.user?.id));
api.post('/api/crash/bet', betGate, (ctx) => crash.placeCrashBet(ctx.user, ctx.body.amount, ctx.body.autoCashout));
api.post('/api/crash/cashout', requireUser, (ctx) => crash.manualCashout(ctx.user));

// ---------- wallet ----------
api.get('/api/wallet/chains', () => pay.CHAINS);
api.get('/api/wallet/deposit-address', requireUser, (ctx) => pay.depositAddress(ctx.user.id, String(ctx.query.chain)));
api.get('/api/wallet/history', requireUser, (ctx) => ({ deposits: pay.userDeposits(ctx.user.id), withdrawals: pay.userWithdrawals(ctx.user.id) }));
api.post('/api/wallet/withdraw', requireUser, (ctx) => pay.requestWithdrawal(ctx.user, ctx.body));
api.post('/api/payments/webhook', (ctx) => {
  if (!pay.verifySignature(ctx.raw, ctx.req.headers['x-signature'])) throw new HttpError(401, 'Bad signature', 'bad_signature');
  return pay.handleDepositWebhook(ctx.body);
});
// Development only: simulate a confirmed on-chain deposit to your own address.
api.post('/api/dev/mock-deposit', requireUser, (ctx) => {
  if (config.isProd || config.paymentsProvider !== 'mock') throw notFound();
  const chain = String(ctx.body.chain || 'USDT-TRC20');
  const usd = Number(ctx.body.usd);
  if (!(usd > 0 && usd <= 100000)) throw badRequest('usd must be 0-100000');
  const { address } = pay.depositAddress(ctx.user.id, chain);
  return pay.handleDepositWebhook({ type: 'deposit', address, chain, asset: chain.split('-')[0], tx_hash: `dev-${Date.now()}-${Math.random()}`, asset_amount: String(usd), amount_usd: usd, confirmed: true });
});

// ---------- aggregator seamless wallet ----------
const aggregatorOps = { balance: agg.walletBalance, debit: agg.walletDebit, credit: agg.walletCredit, rollback: agg.walletRollback };
api.post('/api/aggregator/:provider/:op', (ctx) => {
  const fn = aggregatorOps[ctx.params.op];
  if (!fn) throw notFound();
  if (!agg.verifyAggregatorSignature(ctx.raw, ctx.req.headers['x-signature'])) throw new HttpError(401, 'Bad signature', 'bad_signature');
  return fn(ctx.body, ctx.params.provider);
});
api.post('/api/provider-demo/spin', (ctx) => agg.demoSpin(ctx.body));

// ---------- public ----------
api.get('/api/public/stats', () => ({
  online: onlineCount(),
  chat: recentChat(),
  recentBets: all(`SELECT b.game, b.amount, b.payout, b.multiplier, b.settled_at AS at, CASE WHEN u.hidden THEN NULL ELSE u.username END AS user
                   FROM bets b JOIN users u ON u.id = b.user_id WHERE b.status = 'settled' ORDER BY b.id DESC LIMIT 20`),
}));
api.get('/api/config', () => ({
  minBet: config.minBet, maxBet: config.maxBet, maxProfit: config.maxProfit, minWithdrawal: config.minWithdrawal,
  mockPayments: !config.isProd && config.paymentsProvider === 'mock', unit: USD,
  variant: config.arena ? 'arena' : 'classic', jackpotRake: config.jackpotRake, duelRake: config.duelRake, pvpMinBet: config.pvpMinBet,
  rtp: Object.fromEntries(Object.entries(ENGINES).map(([k, e]) => [k, 1 - e.edge])),
}));

// ---------- admin ----------
const audit = (ctx, action, target, detail) =>
  run('INSERT INTO audit_log (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)', ctx.user.id, action, target, JSON.stringify(detail ?? null), Date.now());

api.get('/api/admin/overview', requireAdmin, () => {
  const since = (ms) => Date.now() - ms;
  const ggr = (from) => all(`SELECT game, COUNT(*) AS bets, SUM(amount) AS wagered, SUM(amount) - SUM(payout) AS ggr
                             FROM bets WHERE status = 'settled' AND settled_at > ? GROUP BY game ORDER BY wagered DESC`, from);
  const flow = (kind, from) => -(one('SELECT COALESCE(SUM(delta), 0) AS s FROM ledger WHERE kind = ? AND created_at > ?', kind, from).s);
  const provider = (from) => one(`SELECT COALESCE(SUM(CASE WHEN kind='debit' AND rolled_back=0 THEN amount END),0) AS wagered,
                                  COALESCE(SUM(CASE WHEN kind='credit' THEN amount END),0) AS paid FROM provider_txns WHERE created_at > ?`, from);
  return {
    users: one('SELECT COUNT(*) AS n FROM users').n,
    online: onlineCount(),
    liabilities: one('SELECT COALESCE(SUM(balance), 0) AS s FROM balances').s,
    pendingWithdrawals: one("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS s FROM withdrawals WHERE status = 'pending'"),
    day: { ggr: ggr(since(86_400_000)), deposits: -flow('deposit', since(86_400_000)), withdrawals: flow('withdrawal', since(86_400_000)), provider: provider(since(86_400_000)) },
    week: { ggr: ggr(since(7 * 86_400_000)), deposits: -flow('deposit', since(7 * 86_400_000)), withdrawals: flow('withdrawal', since(7 * 86_400_000)), provider: provider(since(7 * 86_400_000)) },
    rewardsPaid: one("SELECT COALESCE(SUM(delta), 0) AS s FROM ledger WHERE kind IN ('rakeback', 'affiliate', 'bonus')").s,
  };
});
api.get('/api/admin/users', requireAdmin, (ctx) => {
  const q = `%${String(ctx.query.q || '')}%`;
  return all(`SELECT u.id, u.username, u.email, u.role, u.wagered, u.deposited, u.kyc_status, u.banned, u.created_at, b.balance
              FROM users u JOIN balances b ON b.user_id = u.id WHERE u.username LIKE ? OR u.email LIKE ? ORDER BY u.id DESC LIMIT 100`, q, q);
});
api.get('/api/admin/users/:id', requireAdmin, (ctx) => {
  const id = Number(ctx.params.id);
  const u = one('SELECT u.*, b.balance FROM users u JOIN balances b ON b.user_id = u.id WHERE u.id = ?', id);
  if (!u) throw notFound();
  delete u.password_hash;
  return {
    user: u,
    ledger: all('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 100', id),
    bets: bets.betHistory(id, { limit: 50 }),
    withdrawals: pay.userWithdrawals(id),
    deposits: pay.userDeposits(id),
  };
});
api.post('/api/admin/users/:id/adjust', requireAdmin, (ctx) => {
  const id = Number(ctx.params.id);
  const amount = Number(ctx.body.amount);
  if (!Number.isInteger(amount) || amount === 0) throw badRequest('amount must be a non-zero integer (micro-USD)');
  const note = String(ctx.body.note || '').slice(0, 200);
  if (!note) throw badRequest('A note is required');
  const kind = ctx.body.kind === 'bonus' ? 'bonus' : 'admin_adjust';
  const balance = tx(() => adjust(id, amount, kind, `admin:${ctx.user.id}:${note}`));
  audit(ctx, 'adjust_balance', `user:${id}`, { amount, kind, note });
  return { balance };
});
api.post('/api/admin/users/:id/flags', requireAdmin, (ctx) => {
  const id = Number(ctx.params.id);
  const b = ctx.body;
  if (b.banned !== undefined) run('UPDATE users SET banned = ? WHERE id = ?', b.banned ? 1 : 0, id);
  if (b.banned) run('DELETE FROM sessions WHERE user_id = ?', id);
  if (b.kycStatus) {
    if (!['none', 'pending', 'verified', 'rejected'].includes(b.kycStatus)) throw badRequest('Invalid KYC status');
    run('UPDATE users SET kyc_status = ? WHERE id = ?', b.kycStatus, id);
  }
  if (b.mutedHours !== undefined) run('UPDATE users SET muted_until = ? WHERE id = ?', Date.now() + Number(b.mutedHours) * 3600_000, id);
  if (b.role) {
    if (!['user', 'admin'].includes(b.role)) throw badRequest('Invalid role');
    run('UPDATE users SET role = ? WHERE id = ?', b.role, id);
  }
  audit(ctx, 'set_flags', `user:${id}`, b);
  return { ok: true };
});
api.get('/api/admin/withdrawals', requireAdmin, (ctx) =>
  all(`SELECT w.*, u.username, u.kyc_status, u.wagered, u.deposited FROM withdrawals w JOIN users u ON u.id = w.user_id
       WHERE w.status = ? ORDER BY w.id ASC LIMIT 200`, String(ctx.query.status || 'pending')),
);
api.post('/api/admin/withdrawals/:id/approve', requireAdmin, (ctx) => {
  const r = pay.approveWithdrawal(ctx.user.id, Number(ctx.params.id));
  audit(ctx, 'approve_withdrawal', `withdrawal:${ctx.params.id}`, r);
  return r;
});
api.post('/api/admin/withdrawals/:id/reject', requireAdmin, (ctx) => {
  const r = pay.rejectWithdrawal(ctx.user.id, Number(ctx.params.id), String(ctx.body.note || ''));
  audit(ctx, 'reject_withdrawal', `withdrawal:${ctx.params.id}`, { note: ctx.body.note });
  return r;
});
api.get('/api/admin/crash', requireAdmin, () => ({
  chains: all('SELECT id, terminal_hash, salt, length, used, created_at FROM crash_chain ORDER BY id DESC'),
  rounds: all('SELECT id, crash_point, status, started_at, ended_at FROM crash_rounds ORDER BY id DESC LIMIT 50'),
}));
api.delete('/api/admin/chat/:id', requireAdmin, (ctx) => {
  deleteChat(Number(ctx.params.id));
  audit(ctx, 'delete_chat', `chat:${ctx.params.id}`);
  return { ok: true };
});
api.get('/api/admin/audit', requireAdmin, () => all('SELECT a.*, u.username AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 200'));

// Arena routes and public profiles.
registerArena(api, { betLimit });
