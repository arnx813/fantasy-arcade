// Arena (player vs player) end-to-end tests on a throwaway database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

process.env.ARENA = '1';
process.env.RATE_LIMIT_SCALE = '1000';
process.env.JACKPOT_COUNTDOWN_MS = '600';
process.env.JACKPOT_SPIN_MS = '200';
process.env.CRASH_CHAIN_LENGTH = '50';
const { start } = await import('../server/index.js');
const { one, all } = await import('../server/db/index.js');
const { jackpotDraw } = await import('../server/services/jackpot.js');
const { duelFlip } = await import('../server/services/duels.js');
const { sha256 } = await import('../server/lib/fair.js');

const USD = 1_000_000;
let server, base;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  cookie = '';
  async req(method, path, body) {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith('fa_sid=')) this.cookie = c.split(';')[0];
    return { status: res.status, data: await res.json() };
  }
  get = (p) => this.req('GET', p);
  post = (p, b = {}) => this.req('POST', p, b);
}
async function player(name, usd = 100) {
  const c = new Client();
  assert.equal((await c.post('/api/auth/register', { username: name, email: `${name}@arena.test`, password: 'hunter2hunter2' })).status, 200);
  if (usd) await c.post('/api/dev/mock-deposit', { usd });
  return c;
}
const balance = async (c) => (await c.get('/api/me')).data.balance;
function reconcile() {
  for (const b of all('SELECT * FROM balances'))
    assert.equal(one('SELECT COALESCE(SUM(delta),0) AS s FROM ledger WHERE user_id = ?', b.user_id).s, b.balance, `ledger mismatch user ${b.user_id}`);
}

before(async () => {
  server = start({ port: 0, dbPath: join(mkdtempSync(join(tmpdir(), 'arena-')), 'a.db') });
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('config reports the arena variant', async () => {
  assert.equal((await new Client().get('/api/config')).data.variant, 'arena');
});

test('jackpot: one player waits, two players draw, winner paid pot minus rake, draw verifies', async () => {
  const a = await player('potter1'), b = await player('potter2');
  const r0 = (await a.get('/api/arena/jackpot')).data.round;
  assert.equal((await a.post('/api/arena/jackpot/enter', { amount: 30 * USD })).status, 200);
  await wait(800);
  assert.equal((await a.get('/api/arena/jackpot')).data.round.status, 'open', 'one player alone never draws');
  await a.post('/api/arena/jackpot/enter', { amount: 10 * USD }); // second entry, same player
  await b.post('/api/arena/jackpot/enter', { amount: 20 * USD });
  assert.equal((await a.get('/api/arena/jackpot')).data.round.status, 'countdown');
  await wait(1100);
  const round = (await a.get(`/api/arena/jackpot/rounds/${r0.id}`)).data;
  assert.equal(round.status, 'ended');
  assert.equal(round.pot, 60 * USD);
  assert.equal(sha256(round.serverSeed), round.seedHash, 'revealed seed matches commitment');
  const { winnerIndex, ticket } = jackpotDraw(round.serverSeed, round.id, round.entries);
  assert.equal(ticket, round.ticket);
  const payout = 60 * USD - Math.floor(60 * USD * 0.03);
  const [ba, bb] = [await balance(a), await balance(b)];
  const winnerIsA = round.entries[winnerIndex].user === 'potter1';
  assert.equal(winnerIsA ? ba : bb, (winnerIsA ? 60 : 80) * USD + payout);
  assert.equal(winnerIsA ? bb : ba, (winnerIsA ? 80 : 60) * USD);
  reconcile();
});

test('jackpot: rejects below-minimum entries', async () => {
  const c = await player('smallfry');
  assert.equal((await c.post('/api/arena/jackpot/enter', { amount: 1000 })).status, 400);
});

test('duels: create, join, settle, verify; cancel refunds; no self-join; one winner per race', async () => {
  const a = await player('flipper1'), b = await player('flipper2'), c = await player('flipper3');
  const d = (await a.post('/api/arena/duels', { amount: 10 * USD, side: 'heads' })).data.duel;
  assert.equal(d.serverSeed, null, 'seed hidden while open');
  assert.equal((await a.post(`/api/arena/duels/${d.id}/join`)).status, 400);
  const [rb, rc] = await Promise.all([b.post(`/api/arena/duels/${d.id}/join`), c.post(`/api/arena/duels/${d.id}/join`)]);
  assert.equal([rb, rc].filter((r) => r.status === 200).length, 1, 'exactly one joiner wins the race');
  const done = (rb.status === 200 ? rb : rc).data.duel;
  assert.equal(sha256(done.serverSeed), done.seedHash);
  assert.equal(duelFlip(done.serverSeed, done.id, done.creatorId, done.joinerId), done.result);
  const payout = Math.floor(20 * USD * 0.975);
  const total = (await balance(a)) + (await balance(b)) + (await balance(c));
  assert.equal(total, 300 * USD - 20 * USD + payout, 'only the rake leaves the players');
  const e = (await a.post('/api/arena/duels', { amount: 5 * USD, side: 'tails' })).data.duel;
  const before = await balance(a);
  assert.equal((await a.post(`/api/arena/duels/${e.id}/cancel`)).status, 200);
  assert.equal(await balance(a), before + 5 * USD);
  assert.equal((await b.post(`/api/arena/duels/${e.id}/join`)).status, 400, 'cancelled duel cannot be joined');
  reconcile();
});

test('profiles and leaderboard reflect player-vs-player results', async () => {
  const c = new Client();
  const lb = (await c.get('/api/arena/leaderboard?period=day')).data;
  assert.ok(lb.rows.length >= 2);
  const p = (await c.get('/api/users/flipper1')).data;
  assert.equal(p.pvp.duelsPlayed, 1);
  assert.equal((await c.get('/api/users/nobody-here')).status, 404);
});
