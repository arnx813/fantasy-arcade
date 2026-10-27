// Live bets table fed by the websocket, with an "all / big wins" filter.
import { h, clear } from './ui.js';
import { usd, mult, GAME_NAMES } from './format.js';
import { onWs } from './ws.js';

export function liveBetsTable(ctx, { limit = 12 } = {}) {
  let filter = 'all';
  const rows = [];
  const body = h('tbody');
  const tabs = h('div', { class: 'tabs' });
  const draw = () => {
    clear(tabs, [['all', 'All bets'], ['big', 'Big wins']].map(([k, l]) => h('button', { class: filter === k ? 'on' : '', onClick: () => { filter = k; draw(); } }, l)));
    const list = rows.filter((b) => filter === 'all' || (b.payout - b.amount >= 100e6 || b.multiplier >= 10 && b.payout > 0)).slice(0, limit);
    clear(body, list.length ? list.map((b) => h('tr',
      h('td', GAME_NAMES[b.game] || b.game),
      h('td', { class: b.user ? '' : 'faint' }, b.user ? h('a', { href: `/u/${b.user}`, class: 'player-link' }, b.user) : 'Hidden'),
      h('td', { class: 'num' }, usd(b.amount)),
      h('td', { class: 'num' }, b.payout > 0 ? mult(b.multiplier) : '0.00×'),
      h('td', { class: `num ${b.payout > b.amount ? 'win' : 'faint'}` }, usd(b.payout - b.amount, { sign: true })))) :
      h('tr', h('td', { colspan: 5, class: 'muted' }, 'No bets yet. Be the first.')));
  };
  ctx.api.get('/api/public/stats').then((s) => { rows.push(...s.recentBets); draw(); }).catch(draw);
  onWs('bet', (m) => { rows.unshift(m.bet); rows.length = Math.min(rows.length, 60); draw(); });
  return h('div', { class: 'panel', style: { padding: '12px' } }, tabs,
    h('table', { class: 'data' }, h('thead', h('tr', h('th', 'Game'), h('th', 'Player'), h('th', { class: 'num' }, 'Bet'), h('th', { class: 'num' }, 'Multiplier'), h('th', { class: 'num' }, 'Profit'))), body));
}
