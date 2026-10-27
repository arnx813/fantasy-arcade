// Pot ring: the jackpot pot drawn as a ring of neon slices, one per entry in entry
// order (cumulative stakes, the same layout the server draws from), with the pot and
// the round status in the centre. A marker orbits the ring; spinTo() spins it several
// turns and eases it onto the winning ticket at angle ticket / pot * 360 (0 = top,
// clockwise).
import { h, clear } from '../ui.js';
import { usd } from '../format.js';
import { serverNow } from '../ws.js';

const NS = 'http://www.w3.org/2000/svg';
const R_IN = 60, R_OUT = 82, R_TRACK = 90;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let uid = 0;

// Stable, well spread neon hue per user id (golden-angle steps).
export function playerColor(userId) {
  const hue = (Number(userId) * 137.508 + 318) % 360;
  return `hsl(${hue.toFixed(1)} 96% 62%)`;
}

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const polar = (r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [(r * Math.cos(a)).toFixed(3), (r * Math.sin(a)).toFixed(3)];
};
// Annulus segment from a0 to a1 degrees (clockwise from the top).
function annulus(a0, a1, r0 = R_IN, r1 = R_OUT) {
  if (a1 - a0 >= 359.999) {
    return `${annulus(0, 180, r0, r1)} ${annulus(180, 360, r0, r1)}`;
  }
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polar(r1, a0), [x1, y1] = polar(r1, a1), [x2, y2] = polar(r0, a1), [x3, y3] = polar(r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

// Merge consecutive entries by the same player into one drawn segment.
export function segmentsOf(entries) {
  const segs = [];
  let acc = 0;
  for (const e of entries || []) {
    const last = segs[segs.length - 1];
    if (last && last.userId === e.userId) last.end += e.amount;
    else segs.push({ userId: e.userId, user: e.user, start: acc, end: acc + e.amount });
    acc += e.amount;
  }
  return { segs, pot: acc };
}

// Where the marker should stop for a finished round: the ticket's exact angle, nudged
// inward from a slice edge only when it would sit on the separator line.
export function landingAngle(round) {
  const { segs, pot } = segmentsOf(round.entries);
  const t = round.result.ticket;
  const seg = segs.find((s) => t >= s.start && t < s.end) || segs[segs.length - 1];
  const a0 = (seg.start / pot) * 360, a1 = (seg.end / pot) * 360;
  const margin = Math.min(1.2, (a1 - a0) * 0.25);
  const exact = (t / pot) * 360;
  return { angle: Math.min(a1 - margin, Math.max(a0 + margin, exact)), seg };
}

export function createPotRing(container, { size = 420, compact = false } = {}) {
  const id = `pr${++uid}`;
  const root = svg('svg', { viewBox: '-100 -100 200 200', class: 'potring-svg', 'aria-hidden': 'true' });
  root.innerHTML = `<defs>
      <filter id="${id}g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <radialGradient id="${id}d" cx="50%" cy="38%" r="65%"><stop offset="0" stop-color="#262233"/><stop offset="1" stop-color="#121217"/></radialGradient>
    </defs>`;
  const bezel = svg('g', { class: 'pr-bezel' });
  bezel.append(svg('circle', { r: R_TRACK, class: 'pr-track' }));
  for (let i = 0; i < 72; i++) {
    const [x, y] = polar(R_TRACK + (i % 6 ? 0 : 0.4), i * 5);
    bezel.append(svg('circle', { cx: x, cy: y, r: i % 6 ? 0.55 : 1.1, class: 'pr-tick' }));
  }
  const timerArc = svg('circle', { r: R_TRACK, class: 'pr-timer', pathLength: 360, transform: 'rotate(-90)' });
  const base = svg('circle', { r: (R_IN + R_OUT) / 2, class: 'pr-base', 'stroke-width': R_OUT - R_IN + 2 });
  const slices = svg('g', { class: 'pr-slices', filter: `url(#${id}g)` });
  const seams = svg('g', { class: 'pr-seams' });
  const mine = svg('g', { class: 'pr-mine' });
  const disc = svg('circle', { r: R_IN - 5, fill: `url(#${id}d)`, class: 'pr-disc' });
  const marker = svg('g', { class: 'pr-marker' });
  marker.innerHTML = `<line x1="0" y1="${-R_IN + 1}" x2="0" y2="${-R_OUT - 3}" class="pr-needle"/>
    <path d="M0 ${-R_OUT - 1} l-4.2 -7 h8.4z" class="pr-tip"/><circle cy="${-R_TRACK - 1}" r="4.4" class="pr-orb"/>`;
  root.append(bezel, timerArc, base, slices, seams, mine, disc, marker);

  const kicker = h('div', { class: 'pr-kicker' }, 'Pot');
  const value = h('div', { class: 'pr-value' }, '$0.00');
  const sub = h('div', { class: 'pr-sub' }, '');
  const center = h('div', { class: 'pr-center', 'aria-live': 'polite' }, kicker, value, sub);
  const el = h('div', { class: `potring ${compact ? 'potring-compact' : ''}`, style: { '--pr-size': `${size}px` } }, root, center);
  container.append(el);

  let round = null, me = null, angle = 0, raf = 0, tickRaf = 0, spinning = false, landed = false, segEls = [], hotIdx = -1;
  // Countdown arc length: the server's countdown length when it sends one, otherwise
  // the first remaining time this page observed for the round.
  let countFrom = null, countRound = null;

  const setMarker = (a) => {
    angle = a;
    marker.setAttribute('transform', `rotate(${(a % 360).toFixed(3)})`);
  };
  setMarker(0);

  function draw() {
    const { segs, pot } = segmentsOf(round?.entries);
    slices.replaceChildren(); seams.replaceChildren(); mine.replaceChildren();
    segEls = [];
    el.classList.toggle('empty', !pot);
    if (!pot) return;
    for (const s of segs) {
      const a0 = (s.start / pot) * 360, a1 = (s.end / pot) * 360;
      const p = svg('path', { d: annulus(a0, a1), fill: playerColor(s.userId), class: 'pr-slice' });
      if (s.userId === me) p.classList.add('is-me');
      if (landed && round?.result) p.classList.add(s.userId === round.result.winnerId ? 'won' : 'lost');
      slices.append(p);
      segEls.push({ ...s, a0, a1, el: p });
      if (segs.length > 1) {
        const [x0, y0] = polar(R_IN - 0.5, a0), [x1, y1] = polar(R_OUT + 0.5, a0);
        seams.append(svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'pr-seam' }));
      }
      if (s.userId === me) mine.append(svg('path', { d: annulus(a0, a1, R_IN - 1.6, R_OUT + 1.6), class: 'pr-mine-outline' }));
    }
  }

  function centerText() {
    if (!round) { clear(sub, 'Connecting'); return; }
    const res = round.result;
    if (landed && res) {
      kicker.textContent = res.winnerId === me ? 'You win' : 'Winner';
      value.textContent = usd(res.payout, { compact: compact || res.payout >= 1e10 });
      clear(sub, h('span', { class: 'pr-winner', style: { color: playerColor(res.winnerId) } }, res.winner || 'Hidden player'),
        ` at ${(res.chance * 100).toFixed(res.chance < 0.1 ? 2 : 1)}%`);
      return;
    }
    kicker.textContent = 'Pot';
    value.textContent = usd(round.pot, { compact: compact || round.pot >= 1e10 });
    const players = round.players?.length || 0;
    if (round.status === 'open') sub.textContent = players ? (compact ? 'Need one more' : 'Waiting for a second player') : (compact ? 'Be first in' : 'Waiting for players');
    else if (round.status === 'countdown') sub.textContent = `Drawing in ${Math.max(0, Math.ceil((round.endsAt - serverNow()) / 1000))}s`;
    else if (round.status === 'drawing') sub.textContent = 'Drawing';
    else sub.textContent = 'Next round soon';
  }

  // Countdown text and the timer arc on the bezel.
  function tick() {
    tickRaf = 0;
    if (!round || round.status !== 'countdown' || spinning || landed) {
      timerArc.style.strokeDasharray = '0 360';
      el.classList.remove('urgent');
      return;
    }
    const left = Math.max(0, round.endsAt - serverNow());
    if (countRound !== round.id) { countRound = round.id; countFrom = round.countdownMs || Math.max(left, 1000); }
    const frac = Math.min(1, left / countFrom);
    timerArc.style.strokeDasharray = `${(frac * 360).toFixed(2)} 360`;
    el.classList.toggle('urgent', left < 5000);
    centerText();
    tickRaf = requestAnimationFrame(tick);
  }
  const startTick = () => { if (!tickRaf) tickRaf = requestAnimationFrame(tick); };

  function update(r, meId) {
    if (meId !== undefined) me = meId;
    if (spinning && r?.id === round?.id) return; // keep the spin running on a resync
    if (r?.id !== round?.id) { landed = false; el.classList.remove('settled'); setMarker(0); }
    round = r;
    el.classList.toggle('live', r?.status === 'countdown');
    el.classList.toggle('drawing', r?.status === 'drawing');
    draw();
    centerText();
    startTick();
  }

  function hot(a) {
    const deg = ((a % 360) + 360) % 360;
    const i = segEls.findIndex((s) => deg >= s.a0 && deg < s.a1);
    if (i === hotIdx) return;
    segEls[hotIdx]?.el.classList.remove('hot');
    segEls[i]?.el.classList.add('hot');
    hotIdx = i;
  }

  // Spin the marker to the winning ticket. Resolves when it lands.
  function spinTo(r, spinMs = 6000) {
    cancelAnimationFrame(raf);
    round = r;
    landed = false;
    spinning = true;
    el.classList.remove('settled');
    el.classList.add('drawing');
    draw();
    centerText();
    const { angle: target } = landingAngle(r);
    const finish = (resolve) => {
      spinning = false;
      landed = true;
      segEls[hotIdx]?.el.classList.remove('hot');
      hotIdx = -1;
      setMarker(target);
      el.classList.remove('drawing');
      el.classList.add('settled');
      draw();
      centerText();
      resolve(target);
    };
    return new Promise((resolve) => {
      if (reduced()) { setMarker(target); return finish(resolve); }
      const from = angle % 360;
      const turns = spinMs >= 3000 ? 6 : 3;
      const dist = turns * 360 + ((target - from + 360) % 360);
      const dur = Math.max(1200, spinMs);
      const t0 = performance.now();
      const ease = (t) => 1 - Math.pow(1 - t, 4);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const a = from + dist * ease(t);
        setMarker(a);
        hot(a);
        if (t < 1) raf = requestAnimationFrame(step);
        else finish(resolve);
      };
      raf = requestAnimationFrame(step);
    });
  }

  // Show a finished round as already landed (page opened after the spin).
  function showLanded(r) {
    round = r;
    spinning = false;
    landed = true;
    setMarker(landingAngle(r).angle);
    el.classList.add('settled');
    el.classList.remove('drawing', 'live');
    draw();
    centerText();
  }

  return {
    el, update, spinTo, showLanded,
    get spinning() { return spinning; },
    destroy() { cancelAnimationFrame(raf); cancelAnimationFrame(tickRaf); el.remove(); },
  };
}
