import { h, clear, toast } from '../ui.js';
import { usd, toUnits, ago } from '../format.js';

export async function render(page, _p, ctx) {
  page.append(h('h1', 'Settings & limits'));
  if (!ctx.store.get('me')) { page.append(h('p', { class: 'muted', style: { marginTop: '8px' } }, 'Sign in to manage your account.')); return; }
  await ctx.refreshMe();
  const me = ctx.store.get('me');
  const section = (title, ...kids) => h('section', { class: 'panel stack', style: { marginTop: '20px' } }, h('h2', title), ...kids);

  // Privacy
  const hidden = h('input', { type: 'checkbox', checked: me.hidden });
  hidden.addEventListener('change', async () => {
    if (await ctx.attempt(() => ctx.api.post('/api/me/settings', { hidden: hidden.checked }))) toast(hidden.checked ? 'Your name is now hidden in public feeds' : 'Your name is visible in public feeds', 'success');
  });

  // Password
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minLength: 8 });

  // Limits
  const lim = me.limits;
  const loss = h('input', { class: 'input', type: 'number', min: '0', step: '1', placeholder: 'No limit', value: lim.lossLimitDaily != null ? lim.lossLimitDaily / 1e6 : '' });
  const wager = h('input', { class: 'input', type: 'number', min: '0', step: '1', placeholder: 'No limit', value: lim.wagerLimitDaily != null ? lim.wagerLimitDaily / 1e6 : '' });
  const pending = lim.pending ? h('div', { class: 'notice' }, `Changes take effect ${new Date(lim.pending.effective_at).toLocaleString()}: loss limit ${lim.pending.loss_limit_daily == null ? 'none' : usd(lim.pending.loss_limit_daily)}, wager limit ${lim.pending.wager_limit_daily == null ? 'none' : usd(lim.pending.wager_limit_daily)}.`) : null;

  // Self-exclusion
  const days = h('select', { class: 'input' }, [['1', '24 hours'], ['7', '7 days'], ['30', '30 days'], ['180', '6 months'], ['permanent', 'Permanently']].map(([v, l]) => h('option', { value: v }, l)));
  const excluded = me.selfExcludedUntil && me.selfExcludedUntil > Date.now();

  const tx = h('tbody');
  page.append(
    section('Privacy', h('label', { class: 'row' }, hidden, h('span', 'Hide my username in live bets and leaderboards'))),
    section('Password',
      h('div', { class: 'row', style: { flexWrap: 'wrap' } }, h('label', { class: 'field grow' }, 'Current password', cur), h('label', { class: 'field grow' }, 'New password', next)),
      h('div', h('button', { class: 'btn', onClick: async () => {
        if (await ctx.attempt(() => ctx.api.post('/api/me/password', { current: cur.value, next: next.value }))) { toast('Password changed. Other sessions were signed out.', 'success'); cur.value = next.value = ''; }
      } }, 'Change password'))),
    section('Play limits',
      h('p', { class: 'small muted' }, 'Limits cover a rolling 24 hours. Lowering a limit applies immediately; raising or removing one waits 24 hours.'),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } },
        h('label', { class: 'field grow' }, 'Loss limit (USD per 24h)', loss), h('label', { class: 'field grow' }, 'Wager limit (USD per 24h)', wager)),
      h('p', { class: 'small muted' }, `Last 24h: wagered ${usd(lim.usage.wagered)}, net loss ${usd(lim.usage.netLoss)}.`),
      pending,
      h('div', h('button', { class: 'btn btn-primary', onClick: async () => {
        const body = { lossLimitDaily: loss.value === '' ? null : toUnits(loss.value), wagerLimitDaily: wager.value === '' ? null : toUnits(wager.value) };
        const r = await ctx.attempt(() => ctx.api.post('/api/me/limits', body));
        if (r) { toast(r.pending ? 'Saved. The higher limit starts in 24 hours.' : 'Limits saved', 'success'); clear(page); render(page, _p, ctx); }
      } }, 'Save limits'))),
    section('Take a break',
      excluded ? h('p', `You are self-excluded until ${me.selfExcludedUntil > 8e15 ? 'further notice' : new Date(me.selfExcludedUntil).toLocaleString()}. You can still withdraw.`) : [
        h('p', { class: 'small muted' }, 'Self-exclusion blocks all betting on this account for the period you choose. It cannot be shortened or undone.'),
        h('div', { class: 'row' }, days, h('button', { class: 'btn', style: { color: 'var(--loss)' }, onClick: async () => {
          if (!confirm(`Exclude yourself for ${days.selectedOptions[0].text.toLowerCase()}? This cannot be undone.`)) return;
          if (await ctx.attempt(() => ctx.api.post('/api/me/self-exclude', { days: days.value }))) { toast('Self-exclusion is active', 'success'); clear(page); render(page, _p, ctx); }
        } }, 'Self-exclude')),
      ]),
    section('Transactions', h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'data' },
      h('thead', h('tr', h('th', 'Type'), h('th', 'Reference'), h('th', { class: 'num' }, 'Change'), h('th', { class: 'num' }, 'Balance'), h('th', 'When'))), tx))));

  const KIND = { deposit: 'Deposit', withdrawal: 'Withdrawal', withdrawal_refund: 'Withdrawal refund', bet: 'Bet', payout: 'Payout', rakeback: 'Rakeback', affiliate: 'Referral commission',
    bonus: 'Bonus', admin_adjust: 'Adjustment', provider_debit: 'Slots bet', provider_credit: 'Slots win', provider_rollback: 'Slots refund' };
  const rows = await ctx.api.get('/api/me/transactions');
  clear(tx, rows.length ? rows.map((r) => h('tr', h('td', KIND[r.kind] || r.kind), h('td', { class: 'faint small' }, r.ref || ''),
    h('td', { class: `num ${r.delta > 0 ? 'win' : ''}` }, usd(r.delta, { sign: true })), h('td', { class: 'num' }, usd(r.balance_after)), h('td', { class: 'faint' }, ago(r.created_at)))) :
    h('tr', h('td', { colspan: 5, class: 'muted' }, 'No transactions yet.')));
}
