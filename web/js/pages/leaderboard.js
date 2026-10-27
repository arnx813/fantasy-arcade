// PvP leaderboard: profit across jackpot and duels for today, this week or all time.
import { h, clear } from '../ui.js';
import { usd } from '../format.js';
import { useCss } from '../games/common.js';
import { avatar, playerLink, tier, winRate } from './profile.js';

const PERIODS = [['day', 'Today'], ['week', 'This week'], ['all', 'All time']];

export async function render(page, _params, ctx) {
  useCss('social');
  page.classList.add('so-page');
  let period = 'day';
  try { const saved = localStorage.getItem('fa:lbPeriod'); if (PERIODS.some(([k]) => k === saved)) period = saved; } catch {}

  const tabs = h('div', { class: 'tabs so-tabs', role: 'tablist', 'aria-label': 'Period' });
  const body = h('div', { class: 'so-lb-body', 'aria-live': 'polite' });
  page.append(h('header', { class: 'so-head' },
    h('h1', 'Leaderboard'),
    h('p', { class: 'muted' }, 'Ranked by profit from jackpot rounds and coinflip duels.')), tabs, body);

  let seq = 0;
  async function load() {
    clear(tabs, PERIODS.map(([k, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === period), class: k === period ? 'on' : '', onClick: () => { period = k; try { localStorage.setItem('fa:lbPeriod', k); } catch {} load(); } }, label)));
    const n = ++seq;
    body.classList.add('loading');
    let r;
    try { r = await ctx.api.get(`/api/arena/leaderboard?period=${period}`); } catch (e) {
      if (n === seq) { body.classList.remove('loading'); clear(body, h('div', { class: 'panel so-empty' }, h('p', { class: 'muted' }, e.status === 404 ? 'The leaderboard runs on Fantasy Arena only.' : e.message))); }
      return;
    }
    if (n !== seq) return;
    body.classList.remove('loading');
    draw(r.rows);
  }

  function draw(rows) {
    if (!rows.length) {
      const label = PERIODS.find(([k]) => k === period)[1].toLowerCase();
      clear(body, h('div', { class: 'panel so-empty' },
        h('div', { class: 'so-podium-empty', html: '<svg viewBox="0 0 120 70" aria-hidden="true"><rect x="44" y="14" width="32" height="56" rx="4" fill="#2c2c36"/><rect x="6" y="32" width="34" height="38" rx="4" fill="#22222a"/><rect x="80" y="42" width="34" height="28" rx="4" fill="#22222a"/><path d="M60 3l3 6 6.5 1-4.7 4.5 1.1 6.5-5.9-3.1-5.9 3.1 1.1-6.5L50.5 10l6.5-1z" fill="#ff2e88"/></svg>' }),
        h('h2', 'Nobody on the board yet'),
        h('p', { class: 'muted' }, period === 'all' ? 'Win a duel or a jackpot round to claim the first spot.' : `No one has finished a PvP game ${label === 'today' ? 'today' : label}. Be the first.`),
        h('div', { class: 'row so-empty-actions' }, h('a', { class: 'btn btn-primary', href: '/arena/duels' }, 'Start a duel'), h('a', { class: 'btn btn-glass', href: '/arena/jackpot' }, 'Join the jackpot'))));
      return;
    }
    const top = rows.slice(0, 3);
    const order = top.length === 3 ? [1, 0, 2] : top.length === 2 ? [1, 0] : [0];
    const podium = h('div', { class: `so-podium n${top.length}` }, order.map((i) => {
      const r = top[i];
      return h('div', { class: `so-step p${i + 1}` },
        h('div', { class: 'so-step-who' },
          avatar(r.user, i === 0 ? 'lg' : 'md'),
          playerLink(r.user, 'so-step-name'),
          tier(r.vip)),
        h('div', { class: 'so-step-block' },
          h('div', { class: 'so-step-rank' }, String(i + 1)),
          h('div', { class: `so-step-profit ${r.profit >= 0 ? 'win' : 'loss'}` }, usd(r.profit, { sign: true, compact: true })),
          h('div', { class: 'so-step-sub' }, `${r.wins} of ${r.games} won`)));
    }));
    const me = ctx.store.get('me')?.username;
    const table = h('table', { class: 'data so-lb-table' },
      h('thead', h('tr', h('th', { class: 'rank' }, 'Rank'), h('th', 'Player'), h('th', { class: 'col-vip' }, 'VIP'), h('th', { class: 'num col-games' }, 'Games'), h('th', { class: 'num col-wins' }, 'Wins'),
        h('th', { class: 'num' }, 'Win rate'), h('th', { class: 'num col-staked' }, 'Staked'), h('th', { class: 'num' }, 'Profit'))),
      h('tbody', rows.map((r, i) => h('tr', { class: r.user && r.user === me ? 'me' : '' },
        h('td', { class: 'rank' }, h('span', { class: `so-rank r${i + 1}` }, String(i + 1))),
        h('td', h('div', { class: 'so-lb-player' }, avatar(r.user, 'sm'), playerLink(r.user), h('span', { class: 'so-vip-inline' }, tier(r.vip)))),
        h('td', { class: 'col-vip' }, tier(r.vip)),
        h('td', { class: 'num col-games' }, String(r.games)),
        h('td', { class: 'num col-wins' }, String(r.wins)),
        h('td', { class: 'num' }, winRate(r.wins, r.games)),
        h('td', { class: 'num col-staked' }, usd(r.staked, { compact: true })),
        h('td', { class: `num ${r.profit > 0 ? 'win' : r.profit < 0 ? 'loss' : 'faint'}` }, usd(r.profit, { sign: true, compact: true }))))));
    clear(body, podium, h('div', { class: 'panel so-lb-panel' }, table));
  }

  await load();
}
