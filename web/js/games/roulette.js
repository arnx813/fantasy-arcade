// Roulette (single zero): build a chip layout on the table, spin, settle in one request.
import { h, clear } from '../ui.js';
import { statRow } from '../betpanel.js';
import { usd, mult } from '../format.js';
import { resultStrip, placeBet, useCss } from './common.js';
import { reducedMotion, pace } from './cards.js';
import { RED } from '/shared/games/roulette.js';

const CHIPS = [100_000, 1_000_000, 10_000_000, 100_000_000];
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const STEP = 360 / 37;
const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const colOf = (n) => ((n - 1) % 3) + 1;
const OUTSIDE = [['low', '1 to 18'], ['even', 'Even'], ['red', 'Red'], ['black', 'Black'], ['odd', 'Odd'], ['high', '19 to 36']];
const DOZENS = ['1st 12', '2nd 12', '3rd 12'];

// Short chip text: .1, 2.5, 10, 1.2K
function chipText(u) {
  const d = u / 1_000_000;
  if (d >= 1000) return `${+(d / 1000).toFixed(1)}K`;
  if (d < 1) return `.${String(+d.toFixed(2)).split('.')[1]}`;
  return String(+d.toFixed(1));
}

// Every spot on the table: key -> { bet (without amount), label, grid positions }.
function buildSpots() {
  const spots = [];
  spots.push({ key: 'n0', bet: { type: 'straight', numbers: [0] }, label: '0', cls: 'num green zero', pos: [1, 4, 1, 2], vpos: [1, 2, 3, 6], wins: (n) => n === 0, name: 'Straight on 0' });
  for (let n = 1; n <= 36; n++) {
    const c = Math.ceil(n / 3) + 1, r = 4 - colOf(n);
    spots.push({ key: `n${n}`, bet: { type: 'straight', numbers: [n] }, label: String(n), cls: `num ${colorOf(n)}`, pos: [r, r + 1, c, c + 1],
      vpos: [Math.ceil(n / 3) + 1, Math.ceil(n / 3) + 2, 2 + colOf(n), 3 + colOf(n)], wins: (x) => x === n, name: `Straight on ${n}` });
  }
  for (let v = 1; v <= 3; v++) spots.push({ key: `c${v}`, bet: { type: 'column', value: v }, label: '2 to 1', cls: 'side col', pos: [4 - v, 5 - v, 14, 15],
    vpos: [14, 15, 2 + v, 3 + v], wins: (x) => x > 0 && colOf(x) === v, name: `Column ${v}` });
  DOZENS.forEach((label, i) => spots.push({ key: `d${i + 1}`, bet: { type: 'dozen', value: i + 1 }, label, cls: 'side dozen', pos: [4, 5, 2 + i * 4, 6 + i * 4],
    vpos: [2 + i * 4, 6 + i * 4, 2, 3], wins: (x) => x > 0 && Math.ceil(x / 12) === i + 1, name: `${label} dozen` }));
  const test = { low: (x) => x <= 18, high: (x) => x >= 19, even: (x) => x % 2 === 0, odd: (x) => x % 2 === 1, red: (x) => RED.has(x), black: (x) => !RED.has(x) };
  OUTSIDE.forEach(([type, label], i) => spots.push({ key: type, bet: { type }, label, cls: `side out ${type}`, pos: [5, 6, 2 + i * 2, 4 + i * 2],
    vpos: [2 + i * 2, 4 + i * 2, 1, 2], wins: (x) => x > 0 && test[type](x), name: label }));
  return spots;
}

function wheelSvg() {
  const R1 = 92, R0 = 60;
  const pt = (r, a) => [r * Math.sin((a * Math.PI) / 180), -r * Math.cos((a * Math.PI) / 180)];
  const wedges = WHEEL.map((n, i) => {
    const a0 = i * STEP - STEP / 2, a1 = i * STEP + STEP / 2;
    const [x0, y0] = pt(R1, a0), [x1, y1] = pt(R1, a1), [x2, y2] = pt(R0, a1), [x3, y3] = pt(R0, a0);
    const [tx, ty] = pt(80, i * STEP);
    return `<path class="rw-${colorOf(n)}" d="M${x0.toFixed(2)} ${y0.toFixed(2)}A${R1} ${R1} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${R0} ${R0} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z"/>`
      + `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" transform="rotate(${(i * STEP).toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)})">${n}</text>`;
  }).join('');
  const spokes = [...Array(8)].map((_, i) => `<rect x="-2" y="-58" width="4" height="40" rx="2" transform="rotate(${i * 45})"/>`).join('');
  return `<svg viewBox="-100 -100 200 200" aria-hidden="true">
    <circle r="99" class="rw-rim"/>
    <g class="rw-rotor">${wedges}<circle r="${R0}" class="rw-bowl"/><g class="rw-spokes">${spokes}</g><circle r="18" class="rw-hub"/></g>
    <path class="rw-pointer" d="M0 -84L-8 -100H8Z"/>
  </svg>`;
}

export function mount({ controls, stage, foot, ctx }) {
  useCss('roulette');
  let chip = CHIPS[1], busy = false, alive = true, rotation = 0;
  const amounts = {}; // spot key -> units
  let placed = []; // undo stack [key, units]
  let lastLayout = null; // [[key, units]]
  let settled = false; // chips on the table are from the last spin; the next chip starts fresh
  const recent = [];

  // ---------- controls ----------
  const chipBtns = CHIPS.map((v, i) => h('button', { type: 'button', class: `rl-chip c${i} ${v === chip ? 'on' : ''}`, 'aria-pressed': String(v === chip), 'aria-label': `${usd(v)} chip`,
    onClick: () => { chip = v; chipBtns.forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-pressed', String(j === i)); }); } }, chipText(v)));
  const undoBtn = h('button', { class: 'btn grow', type: 'button', onClick: () => undo() }, 'Undo');
  const clearBtn = h('button', { class: 'btn grow', type: 'button', onClick: () => { settled = false; clearMarks(); clearTable(); paint(); } }, 'Clear');
  const rebetBtn = h('button', { class: 'btn grow', type: 'button', onClick: () => rebet() }, 'Rebet');
  const dblBtn = h('button', { class: 'btn grow', type: 'button', onClick: () => { if (settled) rebet(); for (const k in amounts) { placed.push([k, amounts[k]]); amounts[k] *= 2; } paint(); } }, 'Double');
  const spinBtn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onClick: () => spin() }, 'Spin');
  const stats = statRow([['Total bet'], ['Last win']]);
  controls.append(
    h('div', { class: 'field' }, h('div', { class: 'field-row small muted' }, h('span', 'Chip value'), h('span', { class: 'faint' }, 'Right-click removes')),
      h('div', { class: 'rl-chips', role: 'group', 'aria-label': 'Chip value' }, chipBtns)),
    h('div', { class: 'row' }, undoBtn, clearBtn), h('div', { class: 'row' }, rebetBtn, dblBtn),
    spinBtn, stats.el,
    h('p', { class: 'small faint' }, 'Single zero. Straight pays 35:1, dozens and columns 2:1, even-money bets 1:1. Zero loses all outside bets.'));

  // ---------- stage ----------
  const wheel = h('div', { class: 'rl-wheel', html: wheelSvg() });
  const rotor = wheel.querySelector('.rw-rotor');
  const readout = h('div', { class: 'rl-readout', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'faint' }, 'Place your chips'));
  const recentEl = h('div', { class: 'rl-recent', 'aria-label': 'Recent numbers' });
  const spots = buildSpots();
  const cells = {};
  const grid = h('div', { class: 'rl-table', role: 'group', 'aria-label': 'Betting table' }, spots.map((s) => {
    const chipEl = h('span', { class: 'rl-placed', 'aria-hidden': 'true' });
    const el = h('button', { type: 'button', class: `rl-cell ${s.cls}`, 'aria-label': s.name, 'data-key': s.key,
      onClick: () => add(s.key), onContextmenu: (e) => { e.preventDefault(); removeOne(s.key); },
      onMouseenter: () => hover(s, true), onMouseleave: () => hover(s, false), onFocus: () => hover(s, true), onBlur: () => hover(s, false) },
    h('span', { class: 'rl-lbl' }, s.label), chipEl);
    cells[s.key] = { el, chipEl, spot: s };
    return el;
  }));
  // CSS custom properties need setProperty, Object.assign on style ignores them.
  for (const { el, spot: s } of Object.values(cells)) {
    ['--r0', '--r1', '--c0', '--c1', '--vr0', '--vr1', '--vc0', '--vc1'].forEach((k, i) => el.style.setProperty(k, [...s.pos, ...s.vpos][i]));
  }
  stage.append(h('div', { class: 'rl-wrap' },
    h('div', { class: 'rl-top' }, wheel, h('div', { class: 'rl-info' }, readout, recentEl)),
    h('div', { class: 'rl-table-wrap' }, grid)));
  const push = resultStrip(foot);

  // Hovering an outside bet lights the numbers it covers.
  function hover(s, on) {
    if (busy) return;
    if (s.bet.type === 'straight') return;
    for (let n = 1; n <= 36; n++) cells[`n${n}`].el.classList.toggle('cover', on && s.wins(n));
  }

  const total = () => Object.values(amounts).reduce((a, b) => a + b, 0);
  function fresh() {
    if (!settled) return;
    settled = false;
    clearMarks();
    clearTable();
  }
  function add(key) {
    if (busy) return;
    fresh();
    amounts[key] = (amounts[key] || 0) + chip;
    placed.push([key, chip]);
    paint();
  }
  function removeOne(key) {
    if (busy || settled) return;
    const i = placed.map((p) => p[0]).lastIndexOf(key);
    if (i < 0) return;
    const [, u] = placed.splice(i, 1)[0];
    amounts[key] -= u;
    if (amounts[key] <= 0) delete amounts[key];
    paint();
  }
  function undo() {
    if (busy) return;
    if (settled) { settled = false; clearMarks(); clearTable(); paint(); return; }
    const p = placed.pop();
    if (!p) return;
    amounts[p[0]] -= p[1];
    if (amounts[p[0]] <= 0) delete amounts[p[0]];
    paint();
  }
  function clearTable() { for (const k in amounts) delete amounts[k]; placed = []; }
  function rebet() {
    if (busy || !lastLayout) return;
    settled = false;
    clearMarks();
    clearTable();
    for (const [k, u] of lastLayout) { amounts[k] = u; placed.push([k, u]); }
    paint();
  }
  function clearMarks() { for (const c of Object.values(cells)) c.el.classList.remove('hit', 'paid', 'lost'); }

  function paint() {
    for (const [key, c] of Object.entries(cells)) {
      const u = amounts[key] || 0;
      c.chipEl.textContent = u ? chipText(u) : '';
      c.chipEl.className = `rl-placed ${u ? 'on' : ''} t${u >= 100_000_000 ? 3 : u >= 10_000_000 ? 2 : u >= 1_000_000 ? 1 : 0}`;
      c.el.setAttribute('aria-label', `${c.spot.name}${u ? `, ${usd(u)} placed` : ''}`);
      c.el.classList.toggle('has-chip', u > 0);
      c.el.disabled = busy;
    }
    const t = total();
    stats.set(0, usd(t));
    spinBtn.disabled = busy || (!t && !lastLayout);
    spinBtn.textContent = settled ? 'Spin again' : 'Spin';
    undoBtn.disabled = clearBtn.disabled = dblBtn.disabled = busy || !t;
    rebetBtn.disabled = busy || !lastLayout;
    chipBtns.forEach((b) => (b.disabled = busy));
  }

  async function spin() {
    if (busy) return;
    if (settled || (!total() && lastLayout)) rebet();
    const t = total();
    if (!t) return;
    const layout = Object.entries(amounts);
    const bets = layout.map(([k, u]) => ({ ...cells[k].spot.bet, amount: u }));
    busy = true; paint();
    clearMarks();
    try {
      const r = await placeBet(ctx, '/api/games/roulette/bet', { amount: t, params: { bets } });
      if (!r) return;
      lastLayout = layout;
      const n = r.outcome.number;
      clear(readout, h('span', { class: 'faint' }, 'Spinning'));
      await spinTo(n);
      if (!alive) return;
      // Mark the table.
      for (const c of Object.values(cells)) {
        const w = c.spot.wins(n);
        c.el.classList.toggle('hit', w);
        if (amounts[c.spot.key]) c.el.classList.add(w ? 'paid' : 'lost');
      }
      const net = r.payout - r.amount;
      clear(readout,
        h('span', { class: `rl-ball ${r.outcome.color}` }, String(n)),
        h('span', { class: 'rl-res' }, h('strong', r.outcome.color === 'green' ? 'Zero' : `${r.outcome.color === 'red' ? 'Red' : 'Black'} ${n}`),
          h('span', { class: net > 0 ? 'win' : net < 0 ? 'loss' : 'muted' }, net > 0 ? `You win ${usd(r.payout)}` : net < 0 ? `−${usd(-net)}` : 'Stake back')));
      stats.set(1, h('span', { class: r.payout > 0 ? 'win' : '' }, usd(r.payout)));
      push(r.payout > 0 ? mult(r.multiplier) : '0.00×', r.payout > r.amount);
      recent.unshift(n);
      if (recent.length > 12) recent.pop();
      clear(recentEl, recent.map((x, i) => h('span', { class: `rl-dot ${colorOf(x)} ${i === 0 ? 'latest' : ''}` }, String(x))));
      // Chips stay on the table to show what paid; the next placement starts a fresh layout.
      settled = true;
    } finally {
      busy = false;
      paint();
    }
  }

  async function spinTo(n) {
    const i = WHEEL.indexOf(n);
    const target = ((-i * STEP - rotation) % 360 + 360) % 360;
    const reduce = reducedMotion();
    rotation += (reduce ? 0 : 360 * 4) + target;
    rotor.style.transition = reduce ? 'none' : 'transform 3.2s cubic-bezier(0.15, 0.6, 0.12, 1)';
    rotor.style.transform = `rotate(${rotation}deg)`;
    wheel.classList.add('spinning');
    await pace(3300);
    wheel.classList.remove('spinning');
  }

  paint();
  return () => { alive = false; };
}
