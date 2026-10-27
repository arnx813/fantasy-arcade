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
  return r;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmtMult = (m) => mult(m, m >= 100 ? 0 : 2);
export { h, clear };

// Per-game stylesheet: web/css/games/<name>.css, loaded once.
export function useCss(name) {
  const href = `/css/games/${name}.css`;
  if (!document.querySelector(`link[href="${href}"]`)) document.head.append(h('link', { rel: 'stylesheet', href }));
}
