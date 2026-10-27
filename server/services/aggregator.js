// Third-party content (slots, live dealer) via a game aggregator's "seamless wallet".
//
// Flow: the player opens a game -> we mint a launch token -> the aggregator's game
// client calls OUR endpoints (balance / debit / credit / rollback) with that token,
// signed with a shared secret. Every call is idempotent on the aggregator's tx id.
// Amounts on this API are integer micro-USD.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { one, all, run, tx } from '../db/index.js';
import { config } from '../config.js';
import { HttpError, badRequest } from '../lib/http.js';
import { newToken, tokenHash } from '../lib/auth.js';
import { adjust, balanceOf } from './wallet.js';
import { accrueWager, publishBet } from './bets.js';
import { assertCanWager } from './rg.js';

const TOKEN_TTL = 24 * 3600_000;

export function seedMockCatalog() {
  if (!config.enableMockProvider) return;
  const games = [
    ['demo:neon-reels', 'Neon Reels', 'slots', 'Demo Studio', 96],
    ['demo:gem-vault', 'Gem Vault', 'slots', 'Demo Studio', 96],
    ['demo:starfall-7s', 'Starfall 7s', 'slots', 'Demo Studio', 96],
    ['demo:pixel-fruits', 'Pixel Fruits', 'slots', 'Demo Studio', 96],
    ['demo:moon-cascade', 'Moon Cascade', 'slots', 'Demo Studio', 96],
    ['demo:arcade-jackpot', 'Arcade Jackpot', 'slots', 'Demo Studio', 96],
  ];
  for (const [id, name, category, studio, rtp] of games)
    run('INSERT OR IGNORE INTO provider_games (id, provider, name, category, studio, rtp) VALUES (?, ?, ?, ?, ?, ?)', id, 'demo', name, category, studio, rtp);
}

export const providerCatalog = () => all('SELECT id, provider, name, category, studio, rtp FROM provider_games WHERE enabled = 1 ORDER BY category, name');

export function launch(user, gameId) {
  const g = one('SELECT * FROM provider_games WHERE id = ? AND enabled = 1', gameId);
  if (!g) throw new HttpError(404, 'Game not found', 'not_found');
  if (user.self_excluded_until > Date.now() || user.banned) throw new HttpError(403, 'Play is restricted on this account', 'restricted');
  const token = newToken();
  run('INSERT INTO launch_tokens (token_hash, user_id, game_id, expires_at) VALUES (?, ?, ?, ?)', tokenHash(token), user.id, gameId, Date.now() + TOKEN_TTL);
  if (g.provider === 'demo') return { url: `/provider-demo/?token=${encodeURIComponent(token)}&game=${encodeURIComponent(gameId)}` };
  // Real aggregators: call their session/launch API here with `token` and return their URL.
  throw new HttpError(503, 'Aggregator launch not configured', 'aggregator_unconfigured');
}

export function verifyAggregatorSignature(raw, sig, secret = config.aggregatorSecret) {
  const expected = createHmac('sha256', secret).update(raw).digest();
  const got = Buffer.from(String(sig || ''), 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

function session(token) {
  const t = one('SELECT * FROM launch_tokens WHERE token_hash = ?', tokenHash(String(token || '')));
  if (!t || t.expires_at < Date.now()) throw new HttpError(401, 'Invalid or expired session', 'invalid_token');
  const user = one('SELECT * FROM users WHERE id = ?', t.user_id);
  return { user, gameId: t.game_id };
}

const amountOf = (a) => {
  const n = Number(a);
  if (!Number.isInteger(n) || n < 0) throw badRequest('Amount must be integer micro-USD');
  return n;
};

export function walletBalance({ token }) {
  const { user } = session(token);
  return { balance: balanceOf(user.id), currency: 'USD', unit: 'micro' };
}

export function walletDebit({ token, tx_id, round_id, amount }, provider) {
  const { user, gameId } = session(token);
  amount = amountOf(amount);
  return tx(() => {
    const prior = one('SELECT * FROM provider_txns WHERE provider = ? AND provider_tx_id = ?', provider, tx_id);
    if (prior) {
      if (prior.kind === 'rollback') throw new HttpError(409, 'Transaction was rolled back', 'rolled_back');
      return { balance: balanceOf(user.id), duplicate: true };
    }
    assertCanWager(user, amount);
    run("INSERT INTO provider_txns (provider, provider_tx_id, user_id, game_id, round_id, kind, amount, created_at) VALUES (?, ?, ?, ?, ?, 'debit', ?, ?)",
      provider, tx_id, user.id, gameId, round_id, amount, Date.now());
    adjust(user.id, -amount, 'provider_debit', `${provider}:${tx_id}`);
    const rtp = one('SELECT rtp FROM provider_games WHERE id = ?', gameId)?.rtp ?? 96;
    accrueWager(user, amount, 1 - rtp / 100);
    return { balance: balanceOf(user.id) };
  });
}

export function walletCredit({ token, tx_id, round_id, amount }, provider) {
  const { user, gameId } = session(token);
  amount = amountOf(amount);
  return tx(() => {
    if (one('SELECT id FROM provider_txns WHERE provider = ? AND provider_tx_id = ?', provider, tx_id)) return { balance: balanceOf(user.id), duplicate: true };
    run("INSERT INTO provider_txns (provider, provider_tx_id, user_id, game_id, round_id, kind, amount, created_at) VALUES (?, ?, ?, ?, ?, 'credit', ?, ?)",
      provider, tx_id, user.id, gameId, round_id, amount, Date.now());
    adjust(user.id, amount, 'provider_credit', `${provider}:${tx_id}`);
    const staked = one("SELECT COALESCE(SUM(amount), 0) AS s FROM provider_txns WHERE provider = ? AND round_id = ? AND kind = 'debit' AND rolled_back = 0", provider, round_id).s;
    const name = one('SELECT name FROM provider_games WHERE id = ?', gameId)?.name ?? gameId;
    publishBet(user, name, staked, amount);
    return { balance: balanceOf(user.id) };
  });
}

// Rolls back a debit. If the debit never arrived, a tombstone blocks it if it does later.
export function walletRollback({ token, tx_id, original_tx_id }, provider) {
  const { user, gameId } = session(token);
  return tx(() => {
    if (one('SELECT id FROM provider_txns WHERE provider = ? AND provider_tx_id = ?', provider, tx_id)) return { balance: balanceOf(user.id), duplicate: true };
    const debit = one("SELECT * FROM provider_txns WHERE provider = ? AND provider_tx_id = ? AND kind = 'debit'", provider, original_tx_id);
    run("INSERT INTO provider_txns (provider, provider_tx_id, user_id, game_id, kind, amount, created_at) VALUES (?, ?, ?, ?, 'rollback', ?, ?)",
      provider, tx_id, user.id, gameId, debit?.amount ?? 0, Date.now());
    if (!debit) {
      run("INSERT OR IGNORE INTO provider_txns (provider, provider_tx_id, user_id, game_id, kind, amount, rolled_back, created_at) VALUES (?, ?, ?, ?, 'rollback', 0, 1, ?)",
        provider, original_tx_id, user.id, gameId, Date.now());
    } else if (!debit.rolled_back) {
      run('UPDATE provider_txns SET rolled_back = 1 WHERE id = ?', debit.id);
      adjust(user.id, debit.amount, 'provider_rollback', `${provider}:${original_tx_id}`);
    }
    return { balance: balanceOf(user.id) };
  });
}

// ---- Demo provider ----
// Stands in for an aggregator in development: a 3x3 slot whose server calls the same
// seamless-wallet functions a real aggregator would hit over HTTP.
const SYMBOLS = ['cherry', 'lemon', 'bell', 'gem', 'star', 'seven'];
const WEIGHTS = [30, 26, 18, 12, 9, 5];
const BASE_PAYS = { cherry: 1.6, lemon: 2, bell: 4, gem: 8, star: 15, seven: 45 };
// Scale the base paytable so expected return is exactly 96% (lines are correlated,
// but expectation is linear: E = sum over symbols of p^3 * pay).
const TOTAL_W = WEIGHTS.reduce((a, b) => a + b, 0);
const BASE_RTP = SYMBOLS.reduce((a, s, i) => a + (WEIGHTS[i] / TOTAL_W) ** 3 * BASE_PAYS[s], 0);
const PAYS = Object.fromEntries(SYMBOLS.map((s) => [s, Math.round((BASE_PAYS[s] * 0.96 * 100) / BASE_RTP) / 100]));
let demoSeq = 0;
function spinReel(rand) {
  let r = rand() * WEIGHTS.reduce((a, b) => a + b, 0);
  for (let i = 0; i < SYMBOLS.length; i++) if ((r -= WEIGHTS[i]) < 0) return SYMBOLS[i];
  return SYMBOLS[0];
}
export function demoSpin({ token, bet }) {
  if (!config.enableMockProvider) throw new HttpError(404, 'Not found');
  bet = amountOf(bet);
  const round = `demo-${Date.now()}-${++demoSeq}`;
  walletDebit({ token, tx_id: `${round}:d`, round_id: round, amount: bet }, 'demo');
  const grid = [0, 1, 2].map(() => [0, 1, 2].map(() => spinReel(Math.random)));
  const lines = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]];
  const lineBet = bet / lines.length;
  let win = 0;
  const hits = [];
  lines.forEach((l, i) => {
    const s = l.map((row, col) => grid[col][row]);
    if (s[0] === s[1] && s[1] === s[2]) { win += lineBet * PAYS[s[0]]; hits.push(i); }
  });
  win = Math.floor(win);
  const { balance } = walletCredit({ token, tx_id: `${round}:c`, round_id: round, amount: win }, 'demo');
  return { grid, hits, win, balance, pays: PAYS };
}
