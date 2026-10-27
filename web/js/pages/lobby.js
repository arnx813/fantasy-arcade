// Lobby: a night-arcade hero with the live Crash round on the cabinet screen, then
// scrolling rows (recently played, originals, slots), studios, and live bets.
import { h, clear } from '../ui.js';
import { tileArt, providerArt, heroScene } from '../art.js';
import { mult } from '../format.js';
import { onWs, serverNow } from '../ws.js';
import { liveBetsTable } from '../livebets.js';
import { crashMultiplierAt } from '/shared/crash.js';

const RECENT_KEY = 'fa:recent';
export function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}

// A horizontally scrolling row with prev/next buttons that page by its own width.
function strip(title, items, { href, hint } = {}) {
  if (!items.length) return null;
  const track = h('div', { class: 'strip-track' }, items);
  const page = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.9, behavior: 'smooth' });
  const prev = h('button', { class: 'strip-btn', 'aria-label': `Scroll ${title} left`, onClick: () => page(-1), html: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
  const next = h('button', { class: 'strip-btn', 'aria-label': `Scroll ${title} right`, onClick: () => page(1), html: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
  const sync = () => {
    prev.disabled = track.scrollLeft < 4;
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
  };
  track.addEventListener('scroll', sync, { passive: true });
  requestAnimationFrame(sync);
  return h('section', { class: 'strip' },
    h('div', { class: 'strip-head' },
      h('h2', title), hint ? h('span', { class: 'muted small' }, hint) : null,
      h('div', { class: 'strip-actions' }, href ? h('a', { href, class: 'strip-all' }, 'See all') : null, prev, next)),
    track);
}

export async function render(page, _p, ctx) {
  const { originals, providers } = await ctx.api.get('/api/games');
  const me = ctx.store.get('me');

  // ---------- hero ----------
  const screen = h('div', { class: 'hero-screen' }, h('span', { class: 'hero-mult' }, '—'), h('span', { class: 'hero-phase' }, 'Crash'));
  const multEl = screen.firstChild, phaseEl = screen.lastChild;
  const hist = h('div', { class: 'hero-hist' });
  // Art and screen share one fixed-ratio box so the overlay stays on the cabinet.
  const hero = h('section', { class: 'hero' },
    h('div', { class: 'hero-stage' },
      h('div', { class: 'hero-art', html: heroScene() }),
      h('a', { href: '/casino/crash', class: 'hero-screen-link', 'aria-label': 'Open the live Crash round' }, screen)),
    h('div', { class: 'hero-copy' },
      h('div', { class: 'hero-kicker' }, h('span', { class: 'live-dot' }), me ? `Welcome back, ${me.username}` : 'Provably fair, every single bet'),
      h('h1', { class: 'hero-title' }, h('span', 'Insert coin.'), h('span', 'Check the math.')),
      h('p', { class: 'hero-sub' }, me
        ? 'A Crash round is running on the big screen. Jump in or pick a game below.'
        : 'Fourteen house games you can verify yourself, plus slots, rakeback on every wager, and a live Crash round that never stops.'),
      h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '10px' } },
        me ? h('button', { class: 'btn btn-primary btn-lg', onClick: () => ctx.openWallet() }, 'Deposit')
           : h('button', { class: 'btn btn-primary btn-lg', onClick: () => ctx.requireAuth() }, 'Create account'),
        h('a', { href: '/casino/crash', class: 'btn btn-glass btn-lg' }, 'Play Crash')),
      hist));

  let round = null, raf;
  const paint = () => {
    if (round?.phase === 'running') {
      multEl.textContent = mult(crashMultiplierAt(serverNow() - round.startedAt));
      screen.dataset.state = 'running';
      phaseEl.textContent = 'In flight';
    } else if (round?.phase === 'betting') {
      multEl.textContent = `${Math.max(0, (round.bettingEndsAt - serverNow()) / 1000).toFixed(1)}s`;
      screen.dataset.state = 'betting';
      phaseEl.textContent = `Bets open · ${round.bets?.length ?? 0} in`;
    }
    raf = requestAnimationFrame(paint);
  };
  const setHist = (list) => clear(hist, (list || []).slice(0, 6).map((x) => h('span', { class: `result-chip ${x.crashPoint >= 2 ? 'w' : ''}` }, mult(x.crashPoint))));
  const offs = [
    onWs('hello', (m) => { round = m.crash.round; setHist(m.crash.history); }),
    onWs('crash:round', (m) => (round = m.round)),
    onWs('crash:bet', () => round && (round.bets = [...(round.bets || []), {}])),
    onWs('crash:start', (m) => round && Object.assign(round, { phase: 'running', startedAt: m.startedAt })),
    onWs('crash:end', (m) => {
      if (round) round.phase = 'ended';
      multEl.textContent = mult(m.crashPoint);
      screen.dataset.state = 'crashed';
      phaseEl.textContent = 'Crashed';
      setHist(m.history);
    }),
  ];
  ctx.api.get('/api/crash/state').then((s) => { round = s.round; setHist(s.history); }).catch(() => {});
  paint();

  // ---------- tiles ----------
  const tile = (g) => h('a', { class: 'tile', href: `/casino/${g.id}`, 'data-name': g.name.toLowerCase(), html: tileArt(g.id) },
    h('span', { class: 'tile-name' }, g.name), h('span', { class: 'tile-sub' }, 'Fantasy original'));
  const ptile = (g) => h('a', { class: 'tile tile-provider', href: `/play/${encodeURIComponent(g.id)}`, 'data-name': g.name.toLowerCase(), html: providerArt(g.id, g.name) },
    h('span', { class: 'tile-name' }, g.name), h('span', { class: 'tile-sub' }, g.studio || g.provider));

  const byId = Object.fromEntries(originals.map((g) => [g.id, g]));
  const recent = readRecent().map((id) => byId[id]).filter(Boolean);

  // Studios: only the ones actually in the catalog.
  const studios = [{ name: 'Fantasy Originals', count: originals.length, href: '/' },
    ...[...new Set(providers.map((p) => p.studio || p.provider))].map((s) => ({ name: s, count: providers.filter((p) => (p.studio || p.provider) === s).length, href: '/slots' }))];

  // ---------- search ----------
  const results = h('div', { class: 'tiles search-results hidden' });
  const search = h('input', { class: 'input lobby-search', type: 'search', placeholder: 'Search games', 'aria-label': 'Search games' });
  const rows = h('div', { class: 'lobby-rows' });
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    rows.classList.toggle('hidden', !!q);
    results.classList.toggle('hidden', !q);
    if (!q) return;
    const hits = [...originals.filter((g) => g.name.toLowerCase().includes(q)).map(tile), ...providers.filter((g) => g.name.toLowerCase().includes(q)).map(ptile)];
    clear(results, hits.length ? hits : h('p', { class: 'muted' }, `No games match "${search.value}".`));
  });

  // Native append() would print a skipped (null) row as the text "null".
  rows.append(...[
    strip('Recently played', recent.map(tile)),
    strip('Fantasy Originals', originals.map(tile), { hint: 'Seeded per bet, verify any result' }),
    strip('Slots', providers.map(ptile), { href: '/slots' }),
    h('section', { class: 'strip' }, h('div', { class: 'strip-head' }, h('h2', 'Studios')),
      h('div', { class: 'studios' }, studios.map((s) => h('a', { class: 'studio', href: s.href }, h('span', { class: 'studio-name' }, s.name), h('span', { class: 'muted small' }, `${s.count} games`))))),
    h('section', { class: 'strip' }, h('div', { class: 'strip-head' }, h('h2', 'Live bets')), liveBetsTable(ctx)),
  ].filter(Boolean));

  page.classList.add('page-lobby');
  page.append(hero, h('div', { class: 'lobby-searchbar' }, search), results, rows);
  return () => { cancelAnimationFrame(raf); offs.forEach((f) => f()); };
}
