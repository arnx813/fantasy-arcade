// Generates Fantasy Arcade's own payout tables (Plinko, Keno, Wheel), each
// normalised to a target RTP. Output: shared/tables.js. Run: node scripts/gen-tables.js
import { writeFileSync } from 'node:fs';

const RTP = 0.99;

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

// Rounding that keeps tables readable.
function nice(x) {
  if (x < 2) return Math.round(x * 100) / 100;
  if (x < 10) return Math.round(x * 10) / 10;
  if (x < 100) return Math.round(x);
  if (x < 1000) return Math.round(x / 5) * 5;
  return Math.round(x / 50) * 50;
}

// ---------- Plinko ----------
// Symmetric bins; multiplier rises from the centre to the edges with a power curve.
// The exponent is solved so the table hits RTP, then centre bins absorb rounding error.
const PLINKO_SHAPE = {
  low:    { edge: (n) => 5.5 + (n - 8) * 1.3, centre: 0.5 },
  medium: { edge: (n) => 13 * Math.pow(110 / 13, (n - 8) / 8), centre: 0.35 },
  high:   { edge: (n) => 29 * Math.pow(1000 / 29, (n - 8) / 8), centre: 0.2 },
};

function plinkoTable(n, risk) {
  const { edge, centre } = PLINKO_SHAPE[risk];
  const max = edge(n);
  const probs = [...Array(n + 1)].map((_, k) => choose(n, k) / 2 ** n);
  const dist = (k) => Math.abs(k - n / 2) / (n / 2);
  const build = (q) => probs.map((_, k) => centre + (max - centre) * dist(k) ** q);
  const rtp = (m) => m.reduce((s, v, k) => s + v * probs[k], 0);
  // Rounded tables make RTP a step function of q, so scan q finely and keep the
  // table whose RTP is the highest value not above target.
  let best = null;
  for (let q = 0.3; q <= 30; q += 0.0005) {
    const m = build(q).map(nice);
    const r = rtp(m);
    if (r <= RTP && (!best || r > best.r)) best = { m, r };
  }
  const m = best.m;
  // Close the remaining gap by lifting every sub-2x bin by 0.01 at a time. A uniform
  // lift keeps the curve monotonic and symmetric.
  const small = m.map((v, k) => (v < 2 ? k : -1)).filter((k) => k >= 0);
  const pSmall = small.reduce((a, k) => a + probs[k], 0);
  while (rtp(m) + 0.01 * pSmall <= RTP) for (const k of small) m[k] = Math.round((m[k] + 0.01) * 100) / 100;
  return { multipliers: m, rtp: rtp(m) };
}

const plinko = {};
for (const risk of ['low', 'medium', 'high']) {
  plinko[risk] = {};
  for (let n = 8; n <= 16; n++) {
    const t = plinkoTable(n, risk);
    if (t.rtp > RTP || t.rtp < RTP - 0.004) throw new Error(`plinko ${risk} ${n} rtp ${t.rtp}`);
    plinko[risk][n] = t.multipliers;
  }
}

// ---------- Keno ----------
// 40 tiles, 10 drawn, 1..10 picks. Payouts start at a risk-dependent hit threshold
// and grow geometrically; top prize capped, then the curve is renormalised.
const KENO_TILES = 40, KENO_DRAWN = 10, KENO_TOP = 100000;
const kenoCap = (p, h) => KENO_TOP / 4 ** (p - h);
const KENO_SHAPE = {
  classic: { start: (p) => Math.max(1, Math.ceil(p * 0.4)), growth: 3.2 },
  low:     { start: (p) => Math.max(1, Math.ceil(p * 0.3)), growth: 2.2 },
  medium:  { start: (p) => Math.max(1, Math.ceil(p * 0.5)), growth: 4.5 },
  high:    { start: (p) => Math.max(1, Math.ceil(p * 0.7)), growth: 9 },
};
function kenoProb(p, h) {
  return (choose(p, h) * choose(KENO_TILES - p, KENO_DRAWN - h)) / choose(KENO_TILES, KENO_DRAWN);
}
function kenoTable(p, risk) {
  const { start, growth } = KENO_SHAPE[risk];
  const s = start(p);
  const probs = [...Array(p + 1)].map((_, h) => kenoProb(p, h));
  const capped = new Set();
  let m;
  for (let iter = 0; iter < 20; iter++) {
    const w = probs.map((_, h) => (h >= s && !capped.has(h) ? growth ** (h - s) : 0));
    const capMass = [...capped].reduce((a, h) => a + probs[h] * kenoCap(p, h), 0);
    const c = (RTP - capMass) / w.reduce((a, v, h) => a + v * probs[h], 0);
    m = probs.map((_, h) => (capped.has(h) ? kenoCap(p, h) : c * w[h]));
    const over = m.findIndex((v, h) => v > kenoCap(p, h) && !capped.has(h));
    if (over === -1) break;
    for (let h = over; h <= p; h++) capped.add(h);
  }
  m = m.map((v) => (v === 0 ? 0 : nice(v)));
  // Trim the lowest paying tier to land just under RTP after rounding.
  const rtp = () => m.reduce((a, v, h) => a + v * probs[h], 0);
  const first = m.findIndex((v) => v > 0);
  // Coarse steps keep big prizes round; fall back to 0.01 when the tier is likely
  // enough that a coarse step would move RTP by more than 0.2%.
  const coarse = (v) => (v < 2 ? 0.01 : v < 10 ? 0.1 : v < 100 ? 1 : 5);
  const step = (v) => (coarse(v) * probs[first] > 0.002 ? 0.01 : coarse(v));
  const snap = (v) => Math.round(v * 100) / 100;
  for (let g = 0; g < 10000 && rtp() > RTP; g++) m[first] = snap(m[first] - step(m[first]));
  for (let g = 0; g < 10000 && rtp() + step(m[first]) * probs[first] <= RTP; g++) m[first] = snap(m[first] + step(m[first]));
  return { multipliers: m, rtp: rtp() };
}
const keno = {};
for (const risk of Object.keys(KENO_SHAPE)) {
  keno[risk] = {};
  for (let p = 1; p <= 10; p++) {
    const t = kenoTable(p, risk);
    if (t.rtp > RTP + 1e-9 || t.rtp < RTP - 0.005) throw new Error(`keno ${risk} ${p} rtp ${t.rtp}`);
    keno[risk][p] = t.multipliers;
  }
}

// ---------- Wheel ----------
// Every block of 10 segments sums to 9.9 (RTP 0.99); blocks are interleaved so
// larger wheels look varied rather than repeated.
const WHEEL_BLOCKS = {
  low:    [[1.5, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0], [1.2, 1.2, 1.5, 0, 1.2, 1.2, 1.2, 0, 1.2, 1.2]],
  medium: [[0, 1.9, 0, 1.5, 0, 2, 0, 1.5, 0, 3], [0, 1.5, 0, 4, 0, 1.6, 0, 1.6, 0, 1.2], [0, 2, 0, 1.7, 0, 3.2, 0, 1.5, 0, 1.5]],
};
const wheel = { low: {}, medium: {}, high: {} };
for (const segs of [10, 20, 30, 40, 50]) {
  for (const risk of ['low', 'medium']) {
    const blocks = WHEEL_BLOCKS[risk];
    const out = [];
    for (let b = 0; b < segs / 10; b++) out.push(...blocks[b % blocks.length]);
    wheel[risk][segs] = out;
  }
  wheel.high[segs] = [...Array(segs)].map((_, i) => (i === 0 ? Math.round(RTP * segs * 100) / 100 : 0));
}
for (const risk of Object.keys(wheel))
  for (const segs of Object.keys(wheel[risk])) {
    const a = wheel[risk][segs];
    const r = a.reduce((x, y) => x + y, 0) / a.length;
    if (Math.abs(r - RTP) > 1e-9) throw new Error(`wheel ${risk} ${segs} rtp ${r}`);
  }

const out = `// GENERATED by scripts/gen-tables.js — Fantasy Arcade's own payout tables.
// Do not edit by hand; change the shapes in the generator and re-run it.
export const PLINKO = ${JSON.stringify(plinko)};
export const KENO = ${JSON.stringify(keno)};
export const WHEEL = ${JSON.stringify(wheel)};
`;
writeFileSync(new URL('../shared/tables.js', import.meta.url), out);
console.log('plinko high 16:', plinko.high[16].join(' '));
console.log('plinko low 8:', plinko.low[8].join(' '));
console.log('keno high 10:', keno.high[10].join(' '));
console.log('keno classic 5:', keno.classic[5].join(' '));
console.log('wrote shared/tables.js');
