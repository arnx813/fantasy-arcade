// Plinko: a ball drops through a triangle of pegs; at each row it goes left (0) or
// right (1) exactly as the server's `path` says, and lands in bin = number of rights.
// Several balls can be in flight. The win is only shown when its ball lands.
import { h } from '../ui.js';
import { betPanel } from '../betpanel.js';
import { mult } from '../format.js';
import { onWs } from '../ws.js';
import { resultStrip, useCss } from './common.js';
import { PLINKO } from '/shared/tables.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const RISKS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];

// Bin colours: cool violet in the centre, warming through magenta and coral to amber at the edges.
const RAMP = [[104, 92, 214], [170, 86, 214], [238, 82, 156], [255, 93, 100], [255, 170, 40]];
function rampColor(t) {
  const x = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.floor(x), f = x - i;
  const [a, b] = [RAMP[i], RAMP[i + 1]];
  return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function mount({ controls, stage, foot, ctx }) {
  useCss('plinko');
  let rows = Number(localStorage.getItem('fa:plinkoRows')) || 12;
  let risk = localStorage.getItem('fa:plinkoRisk') || 'medium';
  if (!(rows >= 8 && rows <= 16)) rows = 12;
  if (!PLINKO[risk]) risk = 'medium';

  // ---- stage ----
  const canvas = h('canvas', { class: 'plinko-canvas', role: 'img', 'aria-label': 'Plinko board' });
  const wrap = h('div', { class: 'plinko-board' }, canvas);
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  stage.append(h('div', { class: 'plinko' }, wrap, live));
  const push = resultStrip(foot);
  const g = canvas.getContext('2d');

  // ---- controls ----
  const rowsSel = h('select', { class: 'input', 'aria-label': 'Rows' },
    [...Array(9)].map((_, i) => h('option', { value: String(i + 8), selected: i + 8 === rows }, String(i + 8))));
  const riskSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Risk' },
    RISKS.map(([v, l]) => h('button', { type: 'button', class: v === risk ? 'on' : '', 'data-v': v, onClick: () => setRisk(v) }, l)));
  rowsSel.addEventListener('change', () => { rows = Number(rowsSel.value); save(); layout(); });
  function setRisk(v) {
    if (busy()) return;
    risk = v;
    riskSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    save();
    layout();
  }
  const save = () => { try { localStorage.setItem('fa:plinkoRows', rows); localStorage.setItem('fa:plinkoRisk', risk); } catch {} };

  const panel = betPanel({
    extras: [h('label', { class: 'field' }, 'Risk', riskSeg), h('label', { class: 'field' }, 'Rows', rowsSel)],
    play: drop,
  });
  controls.append(panel.el);

  // ---- balance: debit on drop, credit on landing ----
  // The server pushes the settled balance over the websocket as soon as the bet
  // commits; while balls are pending we re-assert the locally held figure.
  let shown = 0, pending = 0, latest = { id: 0, balance: 0 };
  const balls = [];
  const busy = () => pending > 0 || balls.length > 0;
  const offBal = onWs('balance', () => {
    if (!busy()) return;
    ctx.store.set('balance', shown);
  });
  function lockParams() {
    const b = busy();
    ctx.store.set('balanceHold', b);
    rowsSel.disabled = b;
    riskSeg.querySelectorAll('button').forEach((x) => (x.disabled = b));
  }

  async function drop(amount) {
    if (!ctx.requireAuth()) return undefined;
    if (!busy()) shown = ctx.store.get('balance');
    const p = { rows, risk };
    pending++;
    shown -= amount;
    ctx.store.set('balance', shown);
    lockParams();
    const r = await ctx.attempt(() => ctx.api.post('/api/games/plinko/bet', { amount, params: p }));
    pending--;
    if (!r) {
      shown += amount;
      if (!busy()) ctx.store.set('balance', latest.id ? latest.balance : shown);
      lockParams();
      return undefined;
    }
    if (r.id > latest.id) latest = { id: r.id, balance: r.balance };
    launch(r, p);
    return r;
  }

  // ---- geometry ----
  let W = 0, H = 0, dpr = 1, geo = null;
  function layout() {
    const rect = wrap.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(260, rect.width);
    const n = rows;
    // Spacing fits both width (n + 2 pegs on the last row) and the available height.
    const maxH = Math.min(640, Math.max(300, window.innerHeight - 260));
    const s = Math.min(W / (n + 2.2), (maxH - 70) / (n * 0.92 + 1.6));
    const gap = s * 0.92;
    const top = s * 0.9;
    const binH = Math.max(22, Math.min(34, s * 0.95));
    H = top + (n - 1) * gap + s * 0.75 + binH + 10;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = `${H}px`;
    const cx = W / 2;
    const pegR = Math.max(2.2, s * 0.11);
    const binY = top + (n - 1) * gap + s * 0.6;
    const table = PLINKO[risk][n];
    geo = { n, s, gap, top, cx, pegR, ballR: Math.max(4, s * 0.24), binY, binH, table, flash: new Map(), bump: new Map() };
    draw();
  }
  const pegX = (i, j) => geo.cx + (j - (i + 2) / 2) * geo.s;
  const pegY = (i) => geo.top + i * geo.gap;
  const binX = (b) => geo.cx + (b - geo.n / 2) * geo.s;

  // ---- balls ----
  function launch(r, p) {
    const { path, bin, multiplier } = r.outcome;
    // Params cannot change while a ball is pending, so the board matches p.
    const per = reduced() ? 0 : 150 - p.rows * 3; // ms per row
    balls.push({ path, bin, multiplier, r, t0: performance.now(), per, rows: p.rows });
    lockParams();
    kick();
  }

  // Ball position after `t` ms. Row i: the ball strikes the peg at k - i/2 (k = rights
  // so far), then hops half a spacing toward the next row's contact point.
  function ballAt(b, t) {
    const { s } = geo;
    const contact = (i, k) => [geo.cx + (k - i / 2) * s, pegY(i) - geo.pegR - geo.ballR * 0.9];
    const dropMs = b.per * 1.1;
    if (t < dropMs) {
      const u = t / dropMs;
      const [x, y] = contact(0, 0);
      return { x, y: y - s * 1.1 + s * 1.1 * u * u, row: -1 };
    }
    t -= dropMs;
    const seg = Math.floor(t / b.per);
    const u = (t % b.per) / b.per;
    let k = 0;
    for (let i = 0; i < Math.min(seg, b.rows); i++) k += b.path[i];
    if (seg >= b.rows) return null;
    const [x0, y0] = contact(seg, k);
    const k1 = k + b.path[seg];
    const last = seg === b.rows - 1;
    const [x1, y1] = last ? [binX(b.bin), geo.binY + geo.binH * 0.35] : contact(seg + 1, k1);
    const ex = 1 - (1 - u) * (1 - u);
    const hop = geo.s * 0.32;
    return { x: x0 + (x1 - x0) * ex, y: y0 + (y1 - y0) * u * u - hop * Math.sin(Math.PI * u) * (1 - u * 0.4), row: seg, peg: [seg, k] };
  }

  let raf = 0;
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (b.rows !== geo.n) { balls.splice(i, 1); continue; }
      const pos = b.per ? ballAt(b, now - b.t0) : null;
      if (!pos) { balls.splice(i, 1); land(b, now); continue; }
      if (pos.row >= 0 && pos.row !== b.lastRow) { b.lastRow = pos.row; geo.flash.set(pos.peg.join(','), now); }
      b.pos = pos;
    }
    draw(now);
    const animating = balls.length || [...geo.flash.values(), ...geo.bump.values()].some((t) => now - t < 320);
    if (animating) kick();
  }

  function land(b, now) {
    geo.bump.set(b.bin, now);
    const { r } = b;
    shown += r.payout;
    // Once the last ball is down, show the server's figure for the newest bet.
    if (!busy()) shown = latest.balance;
    ctx.store.set('balance', shown);
    push(mult(b.multiplier), r.payout > r.amount);
    live.textContent = `Landed on ${mult(b.multiplier)}`;
    lockParams();
  }

  // ---- drawing ----
  function draw(now = performance.now()) {
    if (!geo) return;
    const { n, s, pegR, binY, binH, table } = geo;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    // pegs
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i + 3; j++) {
        const x = pegX(i, j), y = pegY(i);
        // A peg is struck when the contact point k - i/2 sits on it, i.e. k = j - 1.
        const hitT = geo.flash.get(`${i},${j - 1}`);
        const glow = hitT !== undefined ? Math.max(0, 1 - (now - hitT) / 320) : 0;
        if (glow > 0) {
          g.fillStyle = `rgba(255,179,32,${0.28 * glow})`;
          g.beginPath(); g.arc(x, y, pegR * 3, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = glow > 0 ? '#ffd88a' : '#d9cff5';
        g.beginPath(); g.arc(x, y, pegR, 0, Math.PI * 2); g.fill();
      }
    }

    // bins
    const bw = s * 0.88;
    const fontPx = Math.max(9, Math.min(14, s * 0.3));
    g.font = `700 ${fontPx}px Chivo, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let b = 0; b <= n; b++) {
      const t = Math.abs(b - n / 2) / (n / 2);
      const c = rampColor(t);
      const bt = geo.bump.get(b);
      const k = bt !== undefined ? Math.max(0, 1 - (now - bt) / 320) : 0;
      const x = binX(b) - bw / 2;
      const y = binY + Math.sin(k * Math.PI) * 5;
      g.fillStyle = rgb(c.map((v) => v * 0.55));
      roundRect(x, y + 3, bw, binH, 5); g.fill();
      g.fillStyle = rgb(c);
      roundRect(x, y, bw, binH, 5); g.fill();
      if (k > 0) { g.fillStyle = `rgba(255,255,255,${0.35 * k})`; roundRect(x, y, bw, binH, 5); g.fill(); }
      g.fillStyle = t > 0.85 ? '#2a1a00' : '#fff';
      const m = table[b];
      g.fillText(m >= 100 ? String(Math.round(m)) : m >= 10 ? m.toFixed(0) : String(m), x + bw / 2, y + binH / 2 + 0.5);
    }

    // balls
    for (const b of balls) {
      if (!b.pos) continue;
      const { x, y } = b.pos;
      g.fillStyle = 'rgba(255,179,32,0.25)';
      g.beginPath(); g.arc(x, y, geo.ballR * 1.7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffb320';
      g.beginPath(); g.arc(x, y, geo.ballR, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.65)';
      g.beginPath(); g.arc(x - geo.ballR * 0.3, y - geo.ballR * 0.35, geo.ballR * 0.35, 0, Math.PI * 2); g.fill();
    }
  }
  function roundRect(x, y, w, hh, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + hh, r);
    g.arcTo(x + w, y + hh, x, y + hh, r);
    g.arcTo(x, y + hh, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  const ro = new ResizeObserver(() => { const w = wrap.getBoundingClientRect().width; if (Math.abs(w - W) > 1) layout(); });
  ro.observe(wrap);
  layout();

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    offBal();
    // Settle the display on any balls still falling.
    if (busy() && latest.id) ctx.store.set('balance', latest.balance);
  };
}
