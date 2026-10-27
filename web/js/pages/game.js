// Game page frame: header, controls/stage split, footer with fairness + recent results.
// Each game module exports mount({ controls, stage, foot, ctx, game }) -> cleanup.
import { h } from '../ui.js';
import { GAME_NAMES, pct } from '../format.js';

export async function render(page, { game }, ctx) {
  if (!GAME_NAMES[game]) {
    page.append(h('h1', 'Game not found'), h('p', { class: 'muted' }, h('a', { href: '/' }, 'Back to the lobby')));
    return;
  }
  try {
    const recent = JSON.parse(localStorage.getItem('fa:recent') || '[]').filter((g) => g !== game);
    localStorage.setItem('fa:recent', JSON.stringify([game, ...recent].slice(0, 12)));
  } catch { /* storage unavailable */ }
  const rtp = ctx.store.get('config')?.rtp?.[game] ?? 0.99;
  const controls = h('div', { class: 'controls' });
  const stage = h('div', { class: 'stage' });
  const foot = h('div', { class: 'game-foot' });
  page.append(
    h('div', { class: 'game-head' }, h('h1', GAME_NAMES[game]), h('span', { class: 'rtp' }, `${pct(rtp, 1)} RTP · provably fair`),
      h('a', { href: '/fairness', class: 'small muted', style: { marginLeft: 'auto' } }, 'Verify results')),
    h('div', { class: 'game' }, controls, stage, foot));
  const mod = await import(`../games/${game}.js`);
  const cleanup = await mod.mount({ controls, stage, foot, ctx, game });
  return () => {
    cleanup?.();
    // Never leave the balance frozen after leaving a game mid-animation.
    ctx.store.set('balanceHold', false);
    ctx.refreshMe();
  };
}
