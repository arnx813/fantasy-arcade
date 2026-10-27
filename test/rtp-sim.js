// Monte Carlo RTP check for every engine, driven through the real provably-fair rng.
// Usage: node test/rtp-sim.js [rounds]
import { ENGINES } from '../shared/games/index.js';
import { rngFor, newServerSeed } from '../server/lib/fair.js';
import { BP } from '../shared/fair.js';
import { evaluate } from '../shared/games/videopoker.js';
import { handValue } from '../shared/games/blackjack.js';

const N = Number(process.argv[2] || 200000);
const seed = newServerSeed();
const rng = (i) => rngFor(seed, 'sim', i);

function instant(id, params, n = N) {
  const e = ENGINES[id];
  const p = e.validate(params);
  const wager = e.wager ? e.wager(p) : 100;
  let staked = 0, back = 0;
  for (let i = 0; i < n; i++) {
    const r = e.play(rng(i), p, wager);
    staked += wager;
    back += r.payout ?? (wager * r.multBp) / BP;
  }
  return back / staked;
}

// Simple fixed strategies for stateful games.
function stateful(id, params, strategy, n = N) {
  const e = ENGINES[id];
  const p = e.validate(params);
  let staked = 0, back = 0;
  for (let i = 0; i < n; i++) {
    const r = rng(i);
    const s = e.start(r, p);
    while (!s.done) strategy(e, r, s);
    staked += s.wagerUnits;
    back += s.multBp / BP;
  }
  return back / staked;
}

// Basic-strategy-lite for blackjack (hard totals + doubles on 10/11 + split A/8).
function bjStrategy(e, r, s) {
  const h = s.hands[s.active];
  const { total, soft } = handValue(h.cards);
  const up = Math.min((s.dealer[0] % 13) + 1, 10);
  const upv = up === 1 ? 11 : up;
  const acts = e.actions(s);
  const rk = h.cards[0] % 13;
  if (acts.includes('split') && (rk === 0 || rk === 7)) return e.act(r, s, 'split');
  if (acts.includes('double') && !soft && (total === 11 || (total === 10 && upv < 10))) return e.act(r, s, 'double');
  if (soft) return e.act(r, s, total <= 17 ? 'hit' : 'stand');
  if (total <= 11) return e.act(r, s, 'hit');
  if (total === 12) return e.act(r, s, upv >= 4 && upv <= 6 ? 'stand' : 'hit');
  if (total <= 16) return e.act(r, s, upv <= 6 ? 'stand' : 'hit');
  return e.act(r, s, 'stand');
}
// Video poker: hold pat hands / pairs+ / 4-to-flush, else hold high cards.
function vpStrategy(e, r, s) {
  const hand = s.hand;
  const made = evaluate(hand);
  let holds = [false, false, false, false, false];
  if (made && !['jacks_better', 'two_pair', 'three_kind', 'four_kind'].includes(made)) holds = holds.map(() => true);
  else {
    const ranks = hand.map((c) => c % 13);
    const counts = ranks.map((x) => ranks.filter((y) => y === x).length);
    if (counts.some((c) => c >= 2)) holds = counts.map((c) => c >= 2);
    else {
      const suits = hand.map((c) => Math.floor(c / 13));
      const flushSuit = [0, 1, 2, 3].find((su) => suits.filter((x) => x === su).length === 4);
      if (flushSuit !== undefined) holds = suits.map((x) => x === flushSuit);
      else holds = ranks.map((x) => x === 0 || x >= 10);
    }
  }
  e.act(r, s, 'draw', { holds });
}

const results = {
  'dice over 50': instant('dice', { target: 50, condition: 'over' }),
  'dice under 10': instant('dice', { target: 10, condition: 'under' }),
  'limbo 2x': instant('limbo', { target: 2 }),
  'limbo 10x': instant('limbo', { target: 10 }),
  coinflip: instant('coinflip', { side: 'heads' }),
  'plinko 16 high': instant('plinko', { rows: 16, risk: 'high' }, N * 3),
  'plinko 8 low': instant('plinko', { rows: 8, risk: 'low' }),
  'keno 5 classic': instant('keno', { picks: [1, 2, 3, 4, 5], risk: 'classic' }, N * 2),
  'keno 3 low': instant('keno', { picks: [7, 8, 9], risk: 'low' }),
  'wheel 30 medium': instant('wheel', { segments: 30, risk: 'medium' }),
  'roulette red': instant('roulette', { bets: [{ type: 'red', amount: 100 }] }),
  'roulette straight 17': instant('roulette', { bets: [{ type: 'straight', numbers: [17], amount: 100 }] }, N * 2),
  'baccarat banker': instant('baccarat', { banker: 100 }),
  'baccarat player': instant('baccarat', { player: 100 }),
  'mines 3 x2 reveals': stateful('mines', { mines: 3 }, (e, r, s) => (s.revealed.length < 2 ? e.act(r, s, 'reveal', { tile: s.revealed.length }) : e.act(r, s, 'cashout'))),
  'mines 10 x1 reveal': stateful('mines', { mines: 10 }, (e, r, s) => (s.revealed.length < 1 ? e.act(r, s, 'reveal', { tile: 7 }) : e.act(r, s, 'cashout'))),
  'tower medium x3': stateful('tower', { difficulty: 'medium' }, (e, r, s) => (s.level < 3 ? e.act(r, s, 'pick', { col: 0 }) : e.act(r, s, 'cashout'))),
  'hilo x2 guesses': stateful('hilo', {}, (e, r, s) => {
    if (s.wins >= 2) return e.act(r, s, 'cashout');
    const rk = s.current % 13;
    const choice = rk === 0 ? 'higher' : rk === 12 ? 'lower' : rk >= 6 ? 'lower_eq' : 'higher_eq';
    e.act(r, s, 'guess', { choice });
  }),
  'blackjack basic-ish': stateful('blackjack', {}, bjStrategy, N * 2),
  'video poker simple': stateful('videopoker', {}, vpStrategy, N * 2),
};
for (const [k, v] of Object.entries(results)) console.log(k.padEnd(24), (v * 100).toFixed(2) + '%');
