import { h, clear } from '../ui.js';
import { usd, mult, ago, GAME_NAMES } from '../format.js';

export async function render(page, _p, ctx) {
  page.append(h('h1', 'My bets'));
  if (!ctx.store.get('me')) { page.append(h('p', { class: 'muted', style: { marginTop: '8px' } }, 'Sign in to see your bet history.')); return; }
  const body = h('tbody');
  const more = h('button', { class: 'btn', style: { marginTop: '12px' } }, 'Load more');
  let before;
  const load = async () => {
    const rows = await ctx.api.get(`/api/me/bets${before ? `?before=${before}` : ''}`);
    if (!rows.length && !before) clear(body, h('tr', h('td', { colspan: 6, class: 'muted' }, 'No bets yet. Pick a game from the lobby.')));
    rows.forEach((b) => body.append(h('tr',
      h('td', h('a', { href: '#', onClick: (e) => { e.preventDefault(); showBet(ctx, b.id); } }, `#${b.id}`)),
      h('td', GAME_NAMES[b.game] || b.game), h('td', { class: 'faint' }, ago(b.created_at)),
      h('td', { class: 'num' }, usd(b.amount)), h('td', { class: 'num' }, b.status === 'active' ? 'In play' : mult(b.multiplier)),
      h('td', { class: `num ${b.payout > b.amount ? 'win' : 'faint'}` }, b.status === 'active' ? '—' : usd(b.payout - b.amount, { sign: true })))));
    before = rows.at(-1)?.id;
    more.classList.toggle('hidden', rows.length < 50);
  };
  more.addEventListener('click', load);
  page.append(h('div', { class: 'panel', style: { padding: '8px', marginTop: '16px', overflowX: 'auto' } },
    h('table', { class: 'data' }, h('thead', h('tr', h('th', 'Bet'), h('th', 'Game'), h('th', 'When'), h('th', { class: 'num' }, 'Amount'), h('th', { class: 'num' }, 'Multiplier'), h('th', { class: 'num' }, 'Profit'))), body)), more);
  await load();
}

export async function showBet(ctx, id) {
  const { modal } = await import('../ui.js');
  const b = await ctx.api.get(`/api/bets/${id}`);
  const f = b.fairness;
  modal(`${GAME_NAMES[b.game] || b.game} bet #${b.id}`, h('div', { class: 'stack' },
    h('div', { class: 'stat-row' },
      ...[['Player', b.user || 'Hidden'], ['Amount', usd(b.amount)], ['Multiplier', mult(b.multiplier)], ['Payout', usd(b.payout)]]
        .map(([k, v]) => h('div', { class: 'stat-box' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)))),
    f ? h('div', { class: 'stack small' },
      h('div', h('span', { class: 'muted' }, 'Client seed: '), f.clientSeed),
      h('div', { style: { wordBreak: 'break-all' } }, h('span', { class: 'muted' }, 'Server seed hash: '), f.serverSeedHash),
      h('div', h('span', { class: 'muted' }, 'Nonce: '), String(f.nonce)),
      h('div', { style: { wordBreak: 'break-all' } }, h('span', { class: 'muted' }, 'Server seed: '), f.serverSeed || 'Hidden until you rotate your seed pair'),
      f.serverSeed ? h('a', { class: 'btn', href: `/fairness?game=${b.game}&server=${f.serverSeed}&client=${encodeURIComponent(f.clientSeed)}&nonce=${f.nonce}&params=${encodeURIComponent(JSON.stringify(b.params))}` }, 'Verify this bet') : null)
      : h('p', { class: 'small muted' }, `Crash round ${b.params?.roundId ?? ''}: verify it from the round hash on the fairness page.`)), { wide: true });
}
