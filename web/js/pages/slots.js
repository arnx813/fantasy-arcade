// Slots catalog: every third-party title from the aggregator, searchable by name or studio.
import { h, clear } from '../ui.js';
import { providerArt } from '../art.js';
import { useCss } from '../games/common.js';

const CATS = [['all', 'All'], ['slots', 'Slots'], ['live', 'Live'], ['table', 'Table']];

export async function render(page, _p, ctx) {
  useCss('slots');
  const { providers = [] } = (await ctx.attempt(() => ctx.api.get('/api/games'))) || {};
  let cat = 'all', q = '';

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search games or studios', 'aria-label': 'Search games', autocomplete: 'off' });
  const tabs = h('div', { class: 'tabs slots-tabs', role: 'tablist', 'aria-label': 'Categories' });
  const count = h('span', { class: 'small faint' });
  const grid = h('div', { class: 'tiles slots-grid' });
  const liveNote = providers.some((g) => g.category === 'live') ? null
    : h('p', { class: 'notice slots-note' }, 'Live dealer tables appear here once an aggregator is connected.');

  const tile = (g) => h('a', { class: 'tile tile-provider', href: `/play/${encodeURIComponent(g.id)}`, html: providerArt(g.id, g.name) },
    h('span', { class: 'name' }, g.name),
    h('span', { class: 'sub' }, [g.studio || g.provider, g.rtp ? `${g.rtp}% RTP` : null].filter(Boolean).join(' · ')));

  function paint() {
    clear(tabs, CATS.map(([k, l]) => {
      const n = k === 'all' ? providers.length : providers.filter((g) => g.category === k).length;
      return h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === cat), class: k === cat ? 'on' : '', onClick: () => { cat = k; paint(); } },
        l, h('span', { class: 'slots-n' }, String(n)));
    }));
    const needle = q.trim().toLowerCase();
    const list = providers.filter((g) => (cat === 'all' || g.category === cat)
      && (!needle || g.name.toLowerCase().includes(needle) || String(g.studio || '').toLowerCase().includes(needle)));
    count.textContent = `${list.length} ${list.length === 1 ? 'game' : 'games'}`;
    if (list.length) return clear(grid, list.map(tile));
    clear(grid, h('div', { class: 'slots-empty' },
      h('p', needle ? `No games match “${q.trim()}”.` : 'No games in this category yet.'),
      needle ? h('button', { type: 'button', class: 'btn', onClick: () => { q = ''; search.value = ''; paint(); search.focus(); } }, 'Clear search') : null));
  }
  search.addEventListener('input', () => { q = search.value; paint(); });

  page.append(
    h('div', { class: 'slots-head' },
      h('div', h('h1', 'Slots'), h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Third-party slots and tables, paid from your Fantasy Arcade balance.')),
      h('div', { class: 'slots-search' }, search)),
    h('div', { class: 'slots-bar' }, tabs, count),
    grid,
    liveNote);
  paint();
}
