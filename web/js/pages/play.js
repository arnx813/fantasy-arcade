// Provider game player: mints a launch session and frames the provider's client.
import { h, clear } from '../ui.js';
import { useCss } from '../games/common.js';

export async function render(page, { gameId }, ctx) {
  useCss('slots');
  let id;
  try { id = decodeURIComponent(gameId); } catch { id = gameId; }

  const back = h('a', { href: '/slots', class: 'small muted play-back' }, 'Back to slots');
  const title = h('h1', 'Loading…');
  const studio = h('span', { class: 'small faint' });
  const body = h('div', { class: 'play-frame' });
  page.append(h('div', { class: 'play-head' }, h('div', { class: 'play-title' }, title, studio), back), body);

  // Name and studio come from the public catalog, so they show even when signed out.
  const catalog = await ctx.api.get('/api/games').catch(() => null);
  const game = catalog?.providers?.find((g) => g.id === id);
  if (!game && catalog) {
    title.textContent = 'Game not found';
    clear(body, h('div', { class: 'play-msg' }, h('p', { class: 'muted' }, 'This title is not in the catalog any more.'), h('a', { href: '/slots', class: 'btn' }, 'Browse slots')));
    return;
  }
  title.textContent = game?.name || id;
  studio.textContent = [game?.studio, game?.rtp ? `${game.rtp}% RTP` : null].filter(Boolean).join(' · ');

  if (!ctx.store.get('me')) {
    clear(body, h('div', { class: 'play-msg' },
      h('p', { class: 'display', style: { fontSize: '20px' } }, 'Sign in to play'),
      h('p', { class: 'muted' }, 'Slots are paid from your Fantasy Arcade balance, so you need an account to open them.'),
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: () => ctx.requireAuth() }, 'Sign in to play')));
    return;
  }

  clear(body, h('div', { class: 'play-msg' }, h('p', { class: 'muted' }, 'Opening game…')));
  let res;
  try {
    res = await ctx.api.post('/api/casino/launch', { gameId: id });
  } catch (e) {
    clear(body, h('div', { class: 'play-msg' },
      h('p', { class: 'display', style: { fontSize: '20px' } }, 'This game could not be opened'),
      h('p', { class: 'loss' }, e.message || 'Launch failed'),
      h('a', { href: '/slots', class: 'btn' }, 'Back to slots')));
    return;
  }
  clear(body, h('iframe', {
    src: res.url, title: game?.name || 'Game', allow: 'fullscreen; autoplay',
    referrerPolicy: 'same-origin', class: 'play-iframe',
  }));
}
