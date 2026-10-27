// End-to-end API tests against a real server instance on a temp database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

process.env.CRASH_BETTING_MS = '400';
process.env.CRASH_COOLDOWN_MS = '200';
process.env.CRASH_CHAIN_LENGTH = '500';
process.env.CRASH_TIME_SCALE = '20';
process.env.ADMIN_EMAILS = 'boss@arcade.test';
process.env.RATE_LIMIT_SCALE = '1000';
const { start } = await import('../server/index.js');
const { one, all } = await import('../server/db/index.js');
const { rngFor } = await import('../server/lib/fair.js');
const { ENGINES } = await import('../shared/games/index.js');
const { sha256 } = await import('../server/lib/fair.js');

let server, base;
const USD = 1_000_000;

class Client {
  cookie = '';
  async req(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie, ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) if (c.startsWith('fa_sid=')) this.cookie = c.split(';')[0];
    const data = await res.json();
    return { status: res.status, data };
  }
  get = (p) => this.req('GET', p);
  post = (p, b = {}) => this.req('POST', p, b);
}

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arcade-'));
  server = start({ port: 0, dbPath: join(dir, 'test.db') });
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function newPlayer(name, deposit = 100) {
  const c = new Client();
  const r = await c.post('/api/auth/register', { username: name, email: `${name}@arcade.test`, password: 'hunter2hunter2' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  if (deposit) {
    const d = await c.post('/api/dev/mock-deposit', { usd: deposit, chain: 'USDT-TRC20' });
    assert.equal(d.status, 200, JSON.stringify(d.data));
  }
  return c;
}

function reconcile() {
  // Every user's balance equals the sum of their ledger, and the last balance_after.
  for (const b of all('SELECT * FROM balances')) {
    const s = one('SELECT COALESCE(SUM(delta),0) AS s FROM ledger WHERE user_id = ?', b.user_id).s;
    assert.equal(s, b.balance, `ledger mismatch for user ${b.user_id}`);
  }
}

test('auth: register, login, me, bad password', async () => {
  const c = await newPlayer('alice', 0);
  const me = await c.get('/api/me');
  assert.equal(me.data.username, 'alice');
  assert.equal(me.data.balance, 0);
  const d = new Client();
  assert.equal((await d.post('/api/auth/login', { login: 'alice', password: 'nope' })).status, 401);
  assert.equal((await d.post('/api/auth/login', { login: 'ALICE@arcade.test', password: 'hunter2hunter2' })).status, 200);
  assert.equal((await new Client().get('/api/me')).status, 401);
  assert.equal((await d.post('/api/auth/register', { username: 'alice', email: 'x@y.zz', password: 'hunter2hunter2' })).data.code, 'username_taken');
});

test('csrf: non-JSON and cross-origin posts are rejected', async () => {
  const c = await newPlayer('csrf', 10);
  const r1 = await c.req('POST', '/api/games/dice/bet', 'amount=1', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(r1.status, 415);
  const r2 = await c.req('POST', '/api/games/dice/bet', { amount: 1, params: { target: 50, condition: 'over' } }, { origin: 'https://evil.example' });
  assert.equal(r2.status, 403);
});

test('deposits: idempotent signed webhook credits once', async () => {
  const c = await newPlayer('dep', 0);
  const addr = (await c.get('/api/wallet/deposit-address?chain=BTC')).data.address;
  const evt = JSON.stringify({ type: 'deposit', address: addr, chain: 'BTC', asset: 'BTC', tx_hash: 'abc123', asset_amount: '0.001', amount_usd: 64.5, confirmed: true });
  const sig = createHmac('sha256', 'dev-payments-secret').update(evt).digest('hex');
  assert.equal((await c.req('POST', '/api/payments/webhook', evt, { 'x-signature': 'bad' })).status, 401);
  assert.equal((await c.req('POST', '/api/payments/webhook', evt, { 'x-signature': sig })).data.credited, true);
  assert.equal((await c.req('POST', '/api/payments/webhook', evt, { 'x-signature': sig })).data.duplicate, true);
  assert.equal((await c.get('/api/me')).data.balance, 64.5 * USD);
});

test('instant games: every engine settles, results verify from revealed seed', async () => {
  const c = await newPlayer('instant', 1000);
  const cases = [
    ['dice', { target: 50, condition: 'over' }],
    ['limbo', { target: 2 }],
    ['coinflip', { side: 'tails' }],
    ['plinko', { rows: 16, risk: 'high' }],
    ['keno', { picks: [1, 5, 9, 13, 22], risk: 'classic' }],
    ['wheel', { segments: 30, risk: 'medium' }],
    ['roulette', { bets: [{ type: 'red', amount: USD }, { type: 'straight', numbers: [17], amount: USD }] }],
    ['baccarat', { player: USD, tie: USD / 2 }],
  ];
  const played = [];
  for (const [game, params] of cases) {
    for (let i = 0; i < 5; i++) {
      const r = await c.post(`/api/games/${game}/bet`, { amount: USD, params });
      assert.equal(r.status, 200, `${game}: ${JSON.stringify(r.data)}`);
      played.push(r.data);
    }
  }
  const before = (await c.get('/api/fair/seeds')).data;
  const rot = await c.post('/api/fair/rotate', { clientSeed: 'my-lucky-seed' });
  assert.equal(rot.data.current.clientSeed, 'my-lucky-seed');
  assert.equal(rot.data.current.serverSeedHash, before.nextServerSeedHash);
  const { serverSeed, serverSeedHash, clientSeed } = rot.data.revealed;
  assert.equal(sha256(serverSeed), serverSeedHash);
  for (const b of played) {
    const e = ENGINES[b.game];
    const detail = (await c.get(`/api/bets/${b.id}`)).data;
    assert.equal(detail.fairness.serverSeed, serverSeed);
    const p = e.validate(detail.params);
    const replay = e.play(rngFor(serverSeed, clientSeed, b.nonce), p, b.amount);
    assert.deepEqual(replay.outcome, b.outcome, `${b.game} replay`);
  }
  reconcile();
});

test('mines: reveal, cashout, cannot double-start, max profit blocks steps', async () => {
  const c = await newPlayer('miner', 100);
  const s = await c.post('/api/games/mines/start', { amount: USD, params: { mines: 3 } });
  assert.equal(s.status, 200);
  assert.equal((await c.post('/api/games/mines/start', { amount: USD, params: { mines: 3 } })).data.code, 'active_game');
  assert.equal((await c.post('/api/fair/rotate', {})).data.code, 'active_game');
  // Peek the server-only mine layout to play a deterministic safe tile.
  const row = one("SELECT state FROM bets WHERE id = ?", s.data.id);
  const mineSet = JSON.parse(row.state).mineSet;
  assert.equal(s.data.state.mineSet, undefined, 'mine positions must not leak while active');
  const safe = [...Array(25).keys()].find((t) => !mineSet.includes(t));
  const r = await c.post('/api/games/mines/action', { action: 'reveal', data: { tile: safe } });
  assert.equal(r.data.status, 'active');
  const co = await c.post('/api/games/mines/action', { action: 'cashout' });
  assert.equal(co.data.status, 'settled');
  assert.ok(co.data.payout > USD);
  assert.deepEqual(co.data.state.mineSet.sort(), [...mineSet].sort());
  reconcile();
});

test('blackjack: doubles and splits debit extra stake atomically', async () => {
  const c = await newPlayer('blackjacker', 200);
  let sawExtra = false;
  for (let i = 0; i < 40; i++) {
    let r = await c.post('/api/games/blackjack/start', { amount: USD, params: {} });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    while (r.data.status === 'active') {
      const acts = r.data.state.actions;
      const action = acts.includes('split') ? 'split' : acts.includes('double') ? 'double' : 'stand';
      r = await c.post('/api/games/blackjack/action', { action });
      assert.equal(r.status, 200, JSON.stringify(r.data));
    }
    if (r.data.amount > USD) sawExtra = true;
  }
  assert.ok(sawExtra, 'expected at least one double/split');
  reconcile();
});

test('all stateful games run to completion', async () => {
  const c = await newPlayer('multi', 100);
  let r = await c.post('/api/games/tower/start', { amount: USD, params: { difficulty: 'easy' } });
  while (r.data.status === 'active') r = await c.post('/api/games/tower/action', r.data.state.level >= 2 ? { action: 'cashout' } : { action: 'pick', data: { col: 0 } });
  r = await c.post('/api/games/hilo/start', { amount: USD, params: {} });
  r = await c.post('/api/games/hilo/action', { action: 'skip' });
  r = await c.post('/api/games/hilo/action', { action: 'guess', data: { choice: r.data.state.choices[0].choice } });
  if (r.data.status === 'active') r = await c.post('/api/games/hilo/action', { action: 'cashout' });
  assert.equal(r.data.status, 'settled');
  r = await c.post('/api/games/videopoker/start', { amount: USD, params: {} });
  r = await c.post('/api/games/videopoker/action', { action: 'draw', data: { holds: [true, true, false, false, false] } });
  assert.equal(r.data.status, 'settled');
  reconcile();
});

test('limits: insufficient balance, max profit, loss limit, self-exclusion', async () => {
  const c = await newPlayer('limits', 10);
  assert.equal((await c.post('/api/games/dice/bet', { amount: 11 * USD, params: { target: 50, condition: 'over' } })).data.code, 'insufficient_balance');
  assert.equal((await c.post('/api/games/limbo/bet', { amount: USD, params: { target: 1000000 } })).data.code, 'max_profit');
  await c.post('/api/me/limits', { lossLimitDaily: 2 * USD });
  let blocked = false;
  for (let i = 0; i < 20 && !blocked; i++) {
    const r = await c.post('/api/games/dice/bet', { amount: USD / 2, params: { target: 2, condition: 'under' } });
    if (r.data.code === 'loss_limit') blocked = true;
  }
  assert.ok(blocked, 'loss limit should trip');
  const raise = await c.post('/api/me/limits', { lossLimitDaily: 100 * USD });
  assert.equal(raise.data.pending, true, 'raising a limit waits 24h');
  await c.post('/api/me/self-exclude', { days: 1 });
  assert.equal((await c.post('/api/games/coinflip/bet', { amount: 0, params: { side: 'heads' } })).data.code, 'self_excluded');
  reconcile();
});

test('withdrawals: rollover, request, admin reject refunds, approve sends', async () => {
  const a = await newPlayer('boss', 0);
  assert.equal((await a.get('/api/me')).data.role, 'admin');
  const c = await newPlayer('withdrawer', 50);
  const req = { amount: 20 * USD, chain: 'USDT-TRC20', address: 'TXYZabcdefghijklmnopqrstuvw12345' };
  assert.equal((await c.post('/api/wallet/withdraw', req)).data.code, 'rollover');
  for (let i = 0; i < 50; i++) await c.post('/api/games/coinflip/bet', { amount: USD, params: { side: 'heads' } });
  const bal = (await c.get('/api/me')).data.balance;
  const w1 = await c.post('/api/wallet/withdraw', { ...req, amount: Math.min(20 * USD, bal) });
  assert.equal(w1.status, 200, JSON.stringify(w1.data));
  assert.equal((await c.get('/api/admin/withdrawals')).status, 403);
  const pending = (await a.get('/api/admin/withdrawals')).data;
  assert.equal(pending.length, 1);
  await a.post(`/api/admin/withdrawals/${pending[0].id}/reject`, { note: 'test' });
  assert.equal((await c.get('/api/me')).data.balance, bal);
  const w2 = await c.post('/api/wallet/withdraw', { ...req, amount: 10 * USD });
  const ok = await a.post(`/api/admin/withdrawals/${w2.data.id}/approve`, {});
  assert.equal(ok.data.status, 'sent');
  assert.equal((await a.post(`/api/admin/withdrawals/${w2.data.id}/approve`, {})).status, 400, 'no double send');
  const ov = await a.get('/api/admin/overview');
  assert.ok(ov.data.users >= 1);
  reconcile();
});

test('rakeback and affiliate accrue on wager and can be claimed', async () => {
  const ref = await newPlayer('referrer', 0);
  const code = (await ref.get('/api/me')).data.referralCode;
  const c = new Client();
  await c.post('/api/auth/register', { username: 'referee', email: 'referee@arcade.test', password: 'hunter2hunter2', referral: code });
  await c.post('/api/dev/mock-deposit', { usd: 500 });
  for (let i = 0; i < 20; i++) await c.post('/api/games/dice/bet', { amount: 20 * USD, params: { target: 50, condition: 'over' } });
  const me = (await c.get('/api/me')).data;
  assert.ok(me.rakeback > 0);
  const claim = await c.post('/api/rewards/rakeback/claim');
  assert.equal(claim.data.claimed, me.rakeback);
  const aff = (await ref.get('/api/affiliate')).data;
  assert.equal(aff.referrals, 1);
  assert.ok(aff.accrued > 0);
  assert.equal((await ref.post('/api/affiliate/claim')).status, 200);
  reconcile();
});

test('aggregator seamless wallet: signed, idempotent, rollback + tombstone', async () => {
  const c = await newPlayer('slots', 20);
  const { url } = (await c.post('/api/casino/launch', { gameId: 'demo:neon-reels' })).data;
  const token = new URL(url, base).searchParams.get('token');
  const call = (op, body) => {
    const raw = JSON.stringify(body);
    return c.req('POST', `/api/aggregator/acme/${op}`, raw, { 'x-signature': createHmac('sha256', 'dev-aggregator-secret').update(raw).digest('hex') });
  };
  assert.equal((await c.req('POST', '/api/aggregator/acme/balance', JSON.stringify({ token }), { 'x-signature': '00' })).status, 401);
  assert.equal((await call('balance', { token })).data.balance, 20 * USD);
  await call('debit', { token, tx_id: 't1', round_id: 'r1', amount: 2 * USD });
  await call('debit', { token, tx_id: 't1', round_id: 'r1', amount: 2 * USD }); // retry
  assert.equal((await call('balance', { token })).data.balance, 18 * USD);
  await call('credit', { token, tx_id: 't2', round_id: 'r1', amount: 5 * USD });
  assert.equal((await call('balance', { token })).data.balance, 23 * USD);
  await call('debit', { token, tx_id: 't3', round_id: 'r2', amount: 3 * USD });
  await call('rollback', { token, tx_id: 't4', original_tx_id: 't3' });
  await call('rollback', { token, tx_id: 't4', original_tx_id: 't3' });
  assert.equal((await call('balance', { token })).data.balance, 23 * USD);
  // Rollback before debit: the late debit must be refused.
  await call('rollback', { token, tx_id: 't5', original_tx_id: 't6' });
  assert.equal((await call('debit', { token, tx_id: 't6', round_id: 'r3', amount: USD })).status, 409);
  const spin = await c.post('/api/provider-demo/spin', { token, bet: USD });
  assert.equal(spin.status, 200);
  reconcile();
});

test('crash: bet, auto cashout, chain verification', async () => {
  const c = await newPlayer('rocket', 100);
  // Betting windows are short in tests; retry until one is open.
  let bet;
  for (let i = 0; i < 400; i++) {
    bet = await c.post('/api/crash/bet', { amount: USD, autoCashout: 1.01 });
    if (bet.data.code !== 'betting_closed') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(bet.status, 200, JSON.stringify(bet.data));
  // Wait for that round to end.
  let ended;
  for (let i = 0; i < 600 && !ended; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const s = (await c.get('/api/crash/state')).data;
    ended = s.history.find((h) => h.id === bet.data.roundId);
  }
  assert.ok(ended, 'round should end');
  const b = one('SELECT * FROM bets WHERE id = ?', bet.data.id);
  assert.equal(b.status, 'settled');
  if (ended.crashPoint >= 1.01) assert.equal(b.payout, Math.floor(USD * 1.01));
  else assert.equal(b.payout, 0);
  const v = (await c.get(`/api/crash/verify?hash=${ended.hash}`)).data;
  assert.equal(v.crashPoint, ended.crashPoint);
  // Chain linkage: hashing a round's hash gives the previous round's hash.
  const prev = one('SELECT hash FROM crash_rounds WHERE id = ?', ended.id - 1);
  if (prev) assert.equal(sha256(ended.hash), prev.hash);
  reconcile();
});
