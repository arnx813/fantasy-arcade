import { h } from '../ui.js';
import { usd, pct } from '../format.js';

export async function render(page, _p, ctx) {
  const { levels } = await ctx.api.get('/api/vip');
  const me = ctx.store.get('me');
  page.append(h('h1', 'VIP & rakeback'),
    h('p', { class: 'muted', style: { margin: '8px 0 24px', maxWidth: '62ch' } },
      'Every wager earns rakeback: a share of the house edge on that bet, returned to you. Your share grows as your lifetime wager climbs the tiers.'));
  if (me) {
    const v = me.vip;
    const claimBtn = h('button', { class: 'btn btn-primary', disabled: me.rakeback < 10000 }, `Claim ${usd(me.rakeback)}`);
    claimBtn.addEventListener('click', async () => {
      const r = await ctx.attempt(() => ctx.api.post('/api/rewards/rakeback/claim'));
      if (r) { ctx.store.set('balance', r.balance); claimBtn.textContent = 'Claimed'; claimBtn.disabled = true; }
    });
    page.append(h('div', { class: 'panel stack', style: { marginBottom: '24px' } },
      h('div', { class: 'row', style: { flexWrap: 'wrap' } },
        h('div', { class: 'grow' }, h('div', { class: 'muted small' }, 'Your tier'), h('div', { class: 'display', style: { fontSize: '28px', color: 'var(--marquee)' } }, v.name)),
        h('div', h('div', { class: 'muted small' }, 'Rakeback rate'), h('div', { style: { fontWeight: 700, fontSize: '20px' } }, pct(v.rakeback, 0) + ' of edge'))),
      v.next ? [
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(v.progress * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { style: { width: `${Math.min(100, v.progress * 100)}%` } })),
        h('p', { class: 'small muted' }, `${usd(me.wagered)} wagered. ${usd(v.next.min - me.wagered)} more to reach ${v.next.name}.`),
      ] : h('p', { class: 'small muted' }, 'Top tier reached.'),
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Rakeback ready to claim'), claimBtn)));
  }
  page.append(h('div', { class: 'panel', style: { padding: '8px' } }, h('table', { class: 'data' },
    h('thead', h('tr', h('th', 'Tier'), h('th', { class: 'num' }, 'Lifetime wager'), h('th', { class: 'num' }, 'Rakeback'))),
    h('tbody', levels.map((l) => h('tr', { style: me?.vip.level === l.level ? { background: 'var(--raised)' } : {} },
      h('td', { style: { fontWeight: 700 } }, l.name), h('td', { class: 'num' }, usd(l.min, { compact: true })), h('td', { class: 'num' }, pct(l.rakeback, 0) + ' of edge')))))));
}
