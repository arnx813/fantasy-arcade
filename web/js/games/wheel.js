// Wheel: a ring of segments from WHEEL[risk][segments]; the spin eases to a stop with
// the winning segment centred under the pointer at the top.
import { h, clear } from '../ui.js';
import { betPanel } from '../betpanel.js';
import { mult, usd } from '../format.js';
import { resultStrip, useCss } from './common.js';
import { onWs } from '../ws.js';
import { WHEEL } from '/shared/tables.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const RISKS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const SEGMENTS = [10, 20, 30, 40, 50];
const ZERO = '#2b2142';
// Paying segments get a colour per distinct multiplier, lowest to highest.
const PAY = ['#7c6cf0', '#4f8df5', '#45c4e0', '#45e0a8', '#9be04a', '#e0d84a', '#ffb320', '#ff8a3d', '#ff5d73', '#ee52c4'];

export function mount({ controls, stage, foot, ctx }) {
  useCss('wheel');
  let segments = Number(localStorage.getItem('fa:wheelSeg')) || 30;
  let risk = localStorage.getItem('fa:wheelRisk') || 'medium';
  if (!SEGMENTS.includes(segments)) segments = 30;
  if (!WHEEL[risk]) risk = 'medium';
  let spinning = false, angle = 0, raf = 0, landed = -1, held = null;
  // The server also pushes balances over the websocket; hold the display while spinning.
  const offBal = onWs('balance', () => {
    if (held === null) return;
    ctx.store.set('balance', held);
  });

  // ---- stage ----
  const canvas = h('canvas', { class: 'wheel-canvas', role: 'img', 'aria-label': 'Wheel' });
  const hubVal = h('div', { class: 'wheel-hub-val' }, '');
  const hub = h('div', { class: 'wheel-hub' }, hubVal);
  const pointer = h('div', { class: 'wheel-pointer', 'aria-hidden': 'true' });
  const disc = h('div', { class: 'wheel-disc' }, canvas, hub, pointer);
  const legend = h('div', { class: 'wheel-legend' });
  stage.append(h('div', { class: 'wheel' }, disc, legend));
  const push = resultStrip(foot);
  const g = canvas.getContext('2d');

  // ---- controls ----
  const segSel = h('select', { class: 'input', 'aria-label': 'Segments' }, SEGMENTS.map((n) => h('option', { value: String(n), selected: n === segments }, String(n))));
  const riskSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Risk' },
    RISKS.map(([v, l]) => h('button', { type: 'button', class: v === risk ? 'on' : '', 'data-v': v, onClick: () => setRisk(v) }, l)));
  segSel.addEventListener('change', () => { segments = Number(segSel.value); changed(); });
  function setRisk(v) {
    if (spinning) return;
    risk = v;
    riskSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    changed();
  }
  function changed() {
    try { localStorage.setItem('fa:wheelSeg', segments); localStorage.setItem('fa:wheelRisk', risk); } catch {}
    landed = -1;
    angle = 0;
    hubVal.textContent = '';
    hub.className = 'wheel-hub';
    build();
  }
  function lock(d) {
    spinning = d;
    segSel.disabled = d;
    riskSeg.querySelectorAll('button').forEach((b) => (b.disabled = d));
  }

  const panel = betPanel({
    extras: [h('label', { class: 'field' }, 'Risk', riskSeg), h('label', { class: 'field' }, 'Segments', segSel)],
    play: async (amount) => {
      if (!ctx.requireAuth()) return undefined;
      lock(true);
      try {
        // Show the debit now and the payout when the wheel stops, so the balance does
        // not give the result away mid-spin (the ws push can beat the HTTP response).
        const before = ctx.store.get('balance');
        held = before - amount;
        ctx.store.set('balanceHold', true);
        ctx.store.set('balance', held);
        const r = await ctx.attempt(() => ctx.api.post('/api/games/wheel/bet', { amount, params: { segments, risk } }));
        if (!r) { held = null; ctx.store.set('balanceHold', false); ctx.store.set('balance', before); return; }
        try { await spinTo(r.outcome.segment); } finally { held = null; ctx.store.set('balanceHold', false); ctx.store.set('balance', r.balance); }
        landed = r.outcome.segment;
        const win = r.payout > r.amount;
        hubVal.textContent = mult(r.outcome.multiplier, 2);
        hub.className = `wheel-hub ${r.outcome.multiplier === 0 ? 'l' : win ? 'w' : 'even'}`;
        markLegend(r.outcome.multiplier);
        draw();
        push(mult(r.outcome.multiplier), win);
        return r;
      } finally { lock(false); }
    },
  });
  controls.append(panel.el);

  // ---- model ----
  let table = [], colorOf = new Map();
  function build() {
    table = WHEEL[risk][segments];
    const distinct = [...new Set(table)].sort((a, b) => a - b);
    const paying = distinct.filter((m) => m > 0);
    colorOf = new Map([[0, ZERO]]);
    // Spread the palette so a table with two values still gets contrasting colours.
    paying.forEach((m, i) => colorOf.set(m, PAY[paying.length === 1 ? 4 : Math.round((i * (PAY.length - 1)) / Math.max(1, paying.length - 1))]));
    clear(legend, distinct.map((m) => {
      const hits = table.filter((x) => x === m).length;
      return h('div', { class: 'wheel-chip', 'data-m': String(m), style: `--c: ${m === 0 ? '#4a3d6e' : colorOf.get(m)}` },
        h('span', { class: 'sw' }), h('b', mult(m)), h('span', { class: 'p' }, `${((hits / table.length) * 100).toFixed(hits / table.length < 0.1 ? 1 : 0)}%`));
    }));
    stats();
    size();
  }
  function markLegend(m) {
    legend.querySelectorAll('.wheel-chip').forEach((c) => c.classList.toggle('on', Number(c.dataset.m) === m));
  }
  function stats() {
    const amt = panel.amount.units;
    legend.title = `Top payout ${usd(Math.floor(amt * Math.max(...table)))}`;
  }

  // ---- drawing ----
  let D = 0, dpr = 1;
  function size() {
    const w = disc.getBoundingClientRect().width;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    D = Math.max(200, w);
    canvas.width = canvas.height = Math.round(D * dpr);
    draw();
  }
  // Segment i spans [i, i+1) * step clockwise from the top, rotated by `angle`.
  function draw() {
    const n = table.length;
    if (!n || !D) return;
    const step = (Math.PI * 2) / n;
    const c = D / 2, R = c - 4, rIn = R * 0.58;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, D, D);
    // rim
    g.fillStyle = '#140e22';
    g.beginPath(); g.arc(c, c, R + 3, 0, Math.PI * 2); g.fill();
    g.save();
    g.translate(c, c);
    g.rotate(angle);
    const gap = n >= 40 ? 0.004 : 0.008;
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + i * step + gap, a1 = -Math.PI / 2 + (i + 1) * step - gap;
      const col = colorOf.get(table[i]);
      g.fillStyle = col;
      g.beginPath();
      g.arc(0, 0, R, a0, a1);
      g.arc(0, 0, rIn, a1, a0, true);
      g.closePath();
      g.fill();
      // inner shade band for depth
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath();
      g.arc(0, 0, rIn + (R - rIn) * 0.22, a0, a1);
      g.arc(0, 0, rIn, a1, a0, true);
      g.closePath();
      g.fill();
      if (i === landed) {
        g.strokeStyle = '#fff';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(0, 0, R - 1.5, a0, a1);
        g.arc(0, 0, rIn + 1.5, a1, a0, true);
        g.closePath();
        g.stroke();
      }
    }
    g.restore();
    // inner ring
    g.fillStyle = '#1b1430';
    g.beginPath(); g.arc(c, c, rIn - 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(c, c, rIn * (0.5 + k * 0.17), 0, Math.PI * 2); g.stroke(); }
  }

  // Ends with segment `seg`'s centre at the top: angle ≡ -(seg + 0.5) * step.
  function spinTo(seg) {
    cancelAnimationFrame(raf);
    landed = -1;
    hubVal.textContent = '';
    hub.className = 'wheel-hub spinning';
    markLegend(null);
    const n = table.length, step = (Math.PI * 2) / n, TAU = Math.PI * 2;
    // Land somewhere inside the segment, not dead centre, so it feels physical.
    const jitter = (Math.random() - 0.5) * step * 0.6;
    const want = -(seg + 0.5) * step + jitter;
    const from = angle;
    let delta = ((want - from) % TAU + TAU) % TAU;
    if (reduced()) { angle = from + delta; draw(); return Promise.resolve(); }
    delta += TAU * 4;
    const dur = 3000;
    const t0 = performance.now();
    return new Promise((done) => {
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 4);
        angle = from + delta * e;
        draw();
        if (p < 1) raf = requestAnimationFrame(tick);
        else { angle %= TAU; done(); }
      };
      raf = requestAnimationFrame(tick);
    });
  }

  panel.amount.input.addEventListener('input', stats);
  const ro = new ResizeObserver(() => { if (Math.abs(disc.getBoundingClientRect().width - D) > 1) size(); });
  ro.observe(disc);
  build();
  return () => { cancelAnimationFrame(raf); ro.disconnect(); offBal(); };
}
