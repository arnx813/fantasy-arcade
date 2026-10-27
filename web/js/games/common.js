// Helpers shared by game modules.
import { h, clear } from '../ui.js';
import { mult } from '../format.js';

// Recent-results chips in the game footer (newest first).
export function resultStrip(foot, max = 10) {
  const strip = h('div', { class: 'history-strip', 'aria-label': 'Recent results' });
  foot.append(strip);
  return (label, win) => {
    strip.prepend(h('span', { class: `result-chip ${win ? 'w' : ''}` }, label));
    while (strip.children.length > max) strip.lastChild.remove();
  };
}

// Runs a bet request; on success syncs balance and returns the result.
export async function placeBet(ctx, path, body) {
  if (!ctx.requireAuth()) return undefined;
  const r = await ctx.attempt(() => ctx.api.post(path, body));
  if (r?.balance !== undefined) ctx.store.set('balance', r.balance);
  // Celebrate settled wins of 5x or more (stateful games only once they settle).
  if (r && r.payout > 0 && r.amount > 0 && r.payout >= r.amount * 5 && (r.status === undefined || r.status === 'settled')) winFx(r.payout / r.amount, r.payout);
  return r;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Multiplier pop-up plus a short confetti burst (pop only under reduced motion).
export function winFx(multiplier, payout) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pop = h('div', { class: 'win-pop', role: 'status' },
    h('div', { class: 'm' }, mult(multiplier, multiplier >= 100 ? 0 : 2)),
    h('div', { class: 'p' }, `+$${(payout / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`));
  document.body.append(pop);
  setTimeout(() => pop.remove(), 1800);
  if (reduce) return;
  const c = h('canvas', { class: 'confetti' });
  c.width = innerWidth; c.height = innerHeight;
  document.body.append(c);
  const g = c.getContext('2d');
  const colors = ['#ff2e88', '#29d8ff', '#3ee08f', '#ffd23f', '#ffffff'];
  const bits = [...Array(140)].map(() => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.38,
    vx: (Math.random() - 0.5) * 16, vy: -6 - Math.random() * 12, r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4, w: 6 + Math.random() * 6, color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const tick = (t) => {
    g.clearRect(0, 0, c.width, c.height);
    for (const b of bits) {
      b.vy += 0.42; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.color; g.fillRect(-b.w / 2, -b.w / 4, b.w, b.w / 2); g.restore();
    }
    if (t - t0 < 1800) requestAnimationFrame(tick); else c.remove();
  };
  requestAnimationFrame(tick);
}
export const fmtMult = (m) => mult(m, m >= 100 ? 0 : 2);
export { h, clear };

// Per-game stylesheet: web/css/games/<name>.css, loaded once.
export function useCss(name) {
  const href = `/css/games/${name}.css`;
  if (!document.querySelector(`link[href="${href}"]`)) document.head.append(h('link', { rel: 'stylesheet', href }));
}
