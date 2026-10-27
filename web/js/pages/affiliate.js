import { h, ICONS, copyText } from '../ui.js';
import { usd, pct } from '../format.js';

export async function render(page, _p, ctx) {
  page.append(h('h1', 'Refer friends'));
  if (!ctx.store.get('me')) {
    page.append(h('p', { class: 'muted', style: { margin: '8px 0 16px' } }, 'Earn commission on the house edge of every bet your referrals make, for life.'),
      h('button', { class: 'btn btn-primary', onClick: () => ctx.requireAuth() }, 'Create account to get your link'));
    return;
  }
  const a = await ctx.api.get('/api/affiliate');
  const claim = h('button', { class: 'btn btn-primary', disabled: a.accrued < 10000 }, `Claim ${usd(a.accrued)}`);
  claim.addEventListener('click', async () => {
    const r = await ctx.attempt(() => ctx.api.post('/api/affiliate/claim'));
    if (r) { ctx.store.set('balance', r.balance); claim.disabled = true; claim.textContent = 'Claimed'; }
  });
  const stat = (k, v) => h('div', { class: 'stat-box' }, h('div', { class: 'k' }, k), h('div', { class: 'v', style: { fontSize: '20px' } }, v));
  page.append(
    h('p', { class: 'muted', style: { margin: '8px 0 24px', maxWidth: '62ch' } },
      `You earn ${pct(a.share, 0)} of the house edge on every bet placed by players who sign up with your link. Commission accrues as they play and can be claimed any time.`),
    h('div', { class: 'panel stack' },
      h('label', { class: 'field' }, 'Your link', h('div', { class: 'address-box row' }, h('span', { class: 'grow' }, a.link),
        h('button', { class: 'icon-btn', 'aria-label': 'Copy link', html: ICONS.copy, onClick: () => copyText(a.link) }))),
      h('div', { class: 'stat-row' }, stat('Referrals', String(a.referrals)), stat('Their wagers', usd(a.referralWagered, { compact: true })), stat('Lifetime earned', usd(a.lifetime)), stat('Ready to claim', usd(a.accrued))),
      h('div', claim)));
}
