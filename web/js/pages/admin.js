// Operator console: overview, users, withdrawal queue, crash chain, audit log.
import { h, clear, toast, modal } from '../ui.js';
import { usd, toUnits, ago, GAME_NAMES, pct } from '../format.js';

export async function render(page, _p, ctx) {
  if (ctx.store.get('me')?.role !== 'admin') { page.append(h('h1', 'Admin'), h('p', { class: 'muted', style: { marginTop: '8px' } }, 'Operators only.')); return; }
  const tabs = h('div', { class: 'tabs' });
  const body = h('div', { class: 'stack' });
  page.append(h('h1', { style: { marginBottom: '16px' } }, 'Admin'), tabs, body);
  const views = { Overview: overview, Users: users, Withdrawals: withdrawals, Crash: crash, Audit: audit };
  const show = (name) => {
    clear(tabs, Object.keys(views).map((k) => h('button', { class: k === name ? 'on' : '', onClick: () => show(k) }, k)));
    clear(body, h('p', { class: 'muted' }, 'Loading'));
    views[name]().catch((e) => clear(body, h('p', { class: 'loss' }, e.message)));
  };
  const table = (head, rows, empty = 'Nothing here.') => h('div', { class: 'panel', style: { padding: '8px', overflowX: 'auto' } },
    h('table', { class: 'data' }, h('thead', h('tr', head.map((x) => h('th', { class: /^(Wagered|GGR|Bets|Amount|Balance|Edge|Deposited)/.test(x) ? 'num' : '' }, x)))),
      h('tbody', rows.length ? rows : h('tr', h('td', { colspan: head.length, class: 'muted' }, empty)))));
  const stat = (k, v) => h('div', { class: 'stat-box' }, h('div', { class: 'k' }, k), h('div', { class: 'v', style: { fontSize: '18px' } }, v));

  async function overview() {
    const o = await ctx.api.get('/api/admin/overview');
    const ggrRows = (list) => list.map((g) => h('tr', h('td', GAME_NAMES[g.game] || g.game), h('td', { class: 'num' }, String(g.bets)), h('td', { class: 'num' }, usd(g.wagered)),
      h('td', { class: `num ${g.ggr >= 0 ? 'win' : 'loss'}` }, usd(g.ggr, { sign: true })), h('td', { class: 'num' }, g.wagered ? pct(g.ggr / g.wagered) : '—')));
    const sum = (list) => list.reduce((a, g) => a + g.ggr, 0);
    clear(body,
      h('div', { class: 'stat-row' }, stat('Players', String(o.users)), stat('Online now', String(o.online)), stat('Player balances', usd(o.liabilities)),
        stat('Pending withdrawals', `${o.pendingWithdrawals.n} · ${usd(o.pendingWithdrawals.s)}`), stat('Rewards paid', usd(o.rewardsPaid))),
      h('div', { class: 'stat-row' }, stat('24h deposits', usd(o.day.deposits)), stat('24h withdrawals', usd(o.day.withdrawals)), stat('24h originals GGR', usd(sum(o.day.ggr), { sign: true })),
        stat('24h slots GGR', usd(o.day.provider.wagered - o.day.provider.paid, { sign: true })), stat('7d originals GGR', usd(sum(o.week.ggr), { sign: true }))),
      h('h2', 'Originals, last 24 hours'),
      table(['Game', 'Bets', 'Wagered', 'GGR', 'Edge realised'], ggrRows(o.day.ggr), 'No settled bets in the last 24 hours.'),
      h('h2', 'Originals, last 7 days'),
      table(['Game', 'Bets', 'Wagered', 'GGR', 'Edge realised'], ggrRows(o.week.ggr)));
  }

  async function users(q = '') {
    const search = h('input', { class: 'input', placeholder: 'Search username or email', value: q });
    search.addEventListener('keydown', (e) => e.key === 'Enter' && users(search.value));
    const list = await ctx.api.get(`/api/admin/users?q=${encodeURIComponent(q)}`);
    clear(body, h('div', { class: 'row' }, search, h('button', { class: 'btn', onClick: () => users(search.value) }, 'Search')),
      table(['User', 'Email', 'Balance', 'Wagered', 'Deposited', 'KYC', 'Joined'], list.map((u) => h('tr',
        h('td', h('a', { href: '#', onClick: (e) => { e.preventDefault(); userDetail(u.id); } }, u.username), u.role === 'admin' ? ' (admin)' : '', u.banned ? h('span', { class: 'loss' }, ' banned') : ''),
        h('td', { class: 'faint' }, u.email), h('td', { class: 'num' }, usd(u.balance)), h('td', { class: 'num' }, usd(u.wagered)), h('td', { class: 'num' }, usd(u.deposited)),
        h('td', u.kyc_status), h('td', { class: 'faint' }, ago(u.created_at))))));
  }

  async function userDetail(id) {
    const d = await ctx.api.get(`/api/admin/users/${id}`);
    const u = d.user;
    const amt = h('input', { class: 'input', type: 'number', step: '0.01', placeholder: 'Amount in USD (negative to debit)' });
    const note = h('input', { class: 'input', placeholder: 'Reason (required, kept in the audit log)' });
    const kind = h('select', { class: 'input' }, h('option', { value: 'admin_adjust' }, 'Adjustment'), h('option', { value: 'bonus' }, 'Bonus'));
    const kyc = h('select', { class: 'input' }, ['none', 'pending', 'verified', 'rejected'].map((k) => h('option', { value: k, selected: u.kyc_status === k }, k)));
    const flags = async (b) => { if (await ctx.attempt(() => ctx.api.post(`/api/admin/users/${id}/flags`, b))) { toast('Saved', 'success'); m.close(); userDetail(id); } };
    const m = modal(`${u.username} (#${u.id})`, h('div', { class: 'stack' },
      h('div', { class: 'stat-row' }, stat('Balance', usd(u.balance)), stat('Wagered', usd(u.wagered)), stat('Deposited', usd(u.deposited)), stat('Rakeback owed', usd(u.rakeback_accrued))),
      h('div', { class: 'small muted' }, `${u.email} · joined ${new Date(u.created_at).toLocaleDateString()} · country ${u.country || 'unknown'}${u.self_excluded_until > Date.now() ? ' · self-excluded' : ''}`),
      h('h3', 'Adjust balance'), h('div', { class: 'row' }, amt, kind), note,
      h('div', h('button', { class: 'btn btn-primary', onClick: async () => {
        const r = await ctx.attempt(() => ctx.api.post(`/api/admin/users/${id}/adjust`, { amount: toUnits(amt.value), note: note.value, kind: kind.value }));
        if (r) { toast(`New balance ${usd(r.balance)}`, 'success'); m.close(); userDetail(id); }
      } }, 'Apply')),
      h('h3', 'Account'),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } },
        h('label', { class: 'field' }, 'KYC', h('div', { class: 'row' }, kyc, h('button', { class: 'btn', onClick: () => flags({ kycStatus: kyc.value }) }, 'Set'))),
        h('button', { class: 'btn', onClick: () => flags({ mutedHours: 24 }) }, 'Mute chat 24h'),
        h('button', { class: 'btn', style: { color: 'var(--loss)' }, onClick: () => confirm(u.banned ? 'Unban?' : 'Ban this account and sign it out?') && flags({ banned: !u.banned }) }, u.banned ? 'Unban' : 'Ban')),
      h('h3', 'Recent ledger'),
      h('div', { style: { maxHeight: '260px', overflowY: 'auto' } }, h('table', { class: 'data small' },
        d.ledger.map((l) => h('tr', h('td', l.kind), h('td', { class: 'faint' }, l.ref || ''), h('td', { class: 'num' }, usd(l.delta, { sign: true })), h('td', { class: 'num' }, usd(l.balance_after)), h('td', { class: 'faint' }, ago(l.created_at))))))), { wide: true });
  }

  async function withdrawals(status = 'pending') {
    const list = await ctx.api.get(`/api/admin/withdrawals?status=${status}`);
    const filter = h('div', { class: 'seg', style: { maxWidth: '420px' } }, ['pending', 'sent', 'failed', 'rejected'].map((s) => h('button', { class: s === status ? 'on' : '', onClick: () => withdrawals(s) }, s)));
    clear(body, filter, table(['ID', 'User', 'Amount', 'Chain', 'Address', 'Checks', 'Requested', ''], list.map((w) => h('tr',
      h('td', `#${w.id}`), h('td', w.username), h('td', { class: 'num' }, usd(w.amount)), h('td', w.chain), h('td', { class: 'small', style: { wordBreak: 'break-all', maxWidth: '220px' } }, w.address),
      h('td', { class: 'small' }, `KYC ${w.kyc_status} · wagered ${usd(w.wagered, { compact: true })} of ${usd(w.deposited, { compact: true })} deposited`),
      h('td', { class: 'faint' }, ago(w.created_at)),
      h('td', status === 'pending' || status === 'failed' ? h('div', { class: 'row' },
        status === 'pending' ? h('button', { class: 'btn btn-win', onClick: async () => { if (await ctx.attempt(() => ctx.api.post(`/api/admin/withdrawals/${w.id}/approve`))) { toast(`Sent #${w.id}`, 'success'); withdrawals(status); } } }, 'Approve') : null,
        h('button', { class: 'btn', onClick: async () => {
          const note = prompt('Reason for rejecting (shown to the player)') ?? null;
          if (note === null) return;
          if (await ctx.attempt(() => ctx.api.post(`/api/admin/withdrawals/${w.id}/reject`, { note }))) { toast(`Rejected and refunded #${w.id}`, 'success'); withdrawals(status); }
        } }, 'Reject')) : h('span', { class: 'faint small' }, w.tx_hash || w.note || '')))), `No ${status} withdrawals.`));
  }

  async function crash() {
    const c = await ctx.api.get('/api/admin/crash');
    clear(body,
      h('h2', 'Hash chains'),
      table(['Chain', 'Commitment', 'Used'], c.chains.map((x) => h('tr', h('td', `#${x.id}`), h('td', { class: 'small', style: { wordBreak: 'break-all' } }, x.terminal_hash), h('td', `${x.used} / ${x.length}`)))),
      h('h2', 'Recent rounds'),
      table(['Round', 'Crash point', 'Status', 'Ended'], c.rounds.map((r) => h('tr', h('td', `#${r.id}`), h('td', `${r.crash_point.toFixed(2)}×`), h('td', r.status), h('td', { class: 'faint' }, r.ended_at ? ago(r.ended_at) : '—')))));
  }

  async function audit() {
    const list = await ctx.api.get('/api/admin/audit');
    clear(body, table(['When', 'Operator', 'Action', 'Target', 'Detail'], list.map((a) => h('tr', h('td', { class: 'faint' }, ago(a.created_at)), h('td', a.actor || '—'), h('td', a.action), h('td', a.target || ''), h('td', { class: 'small faint' }, a.detail || '')))));
  }

  show('Overview');
}
