import { h, clear } from '../ui.js';
import { tileArt, providerArt } from '../art.js';
import { usd, mult, GAME_NAMES, ago } from '../format.js';
import { onWs, serverNow } from '../ws.js';
import { liveBetsTable } from '../livebets.js';
import { crashMultiplierAt } from '/shared/crash.js';

export async function render(page, _p, ctx) {
  const { originals, providers } = await ctx.api.get('/api/games');
  const me = ctx.store.get('me');

  // Hero: the live Crash round, because it is the one thing happening right now.
  const multEl = h('div', { class: 'mult' }, '—');
  const status = h('p', { class: 'muted' });
  const hist = h('div', { class: 'row', style: { flexWrap: 'wrap' } });
  const hero = h('section', { class: 'live-hero' },
    h('div', { class: 'left' },
      h('h1', me ? `Back for more, ${me.username}?` : 'Fourteen house games, every result provable'),
      h('p', { class: 'muted', style: { maxWidth: '46ch' } }, me
        ? 'A Crash round is live right now. Jump in, or pick a table below.'
        : 'Crash, Mines, Plinko, Blackjack and more. Verify any bet yourself from its seeds, and earn rakeback on every wager.'),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } },
        h('a', { href: '/casino/crash', class: 'btn btn-primary btn-lg' }, 'Play Crash'),
        me ? h('button', { class: 'btn btn-lg', onClick: () => ctx.openWallet() }, 'Deposit') : h('button', { class: 'btn btn-lg', onClick: () => ctx.requireAuth() }, 'Create account')),
      status, hist),
    h('a', { href: '/casino/crash', class: 'right', 'aria-label': 'Open Crash' }, multEl));

  let round = null, raf;
  const paint = () => {
    if (round?.phase === 'running') {
      const m = crashMultiplierAt(serverNow() - round.startedAt);
      multEl.textContent = mult(m);
      multEl.style.color = 'var(--ink)';
      status.textContent = 'Round in flight';
    } else if (round?.phase === 'betting') {
      multEl.textContent = `${Math.max(0, (round.bettingEndsAt - serverNow()) / 1000).toFixed(1)}s`;
      multEl.style.color = 'var(--marquee)';
      status.textContent = `Bets open · ${round.bets?.length ?? 0} in`;
    }
    raf = requestAnimationFrame(paint);
  };
  const setHist = (list) => clear(hist, list.slice(0, 8).map((x) => h('span', { class: `result-chip ${x.crashPoint >= 2 ? 'w' : ''}` }, mult(x.crashPoint))));
  const offs = [
    onWs('hello', (m) => { round = m.crash.round; setHist(m.crash.history); }),
    onWs('crash:round', (m) => (round = m.round)),
    onWs('crash:bet', () => round && (round.bets = [...(round.bets || []), {}])),
    onWs('crash:start', (m) => round && Object.assign(round, { phase: 'running', startedAt: m.startedAt })),
    onWs('crash:end', (m) => {
      if (round) round.phase = 'ended';
      multEl.textContent = mult(m.crashPoint);
      multEl.style.color = 'var(--loss)';
      status.textContent = 'Crashed. Next round shortly';
      setHist(m.history);
    }),
  ];
  ctx.api.get('/api/crash/state').then((s) => { round = s.round; setHist(s.history); }).catch(() => {});
  paint();

  const tile = (g) => h('a', { class: 'tile', href: `/casino/${g.id}`, html: tileArt(g.id) },
    h('span', { class: 'name' }, g.name), h('span', { class: 'sub' }, `${g.rtp}% RTP`));
  const ptile = (g) => h('a', { class: 'tile tile-provider', href: `/play/${encodeURIComponent(g.id)}`, html: providerArt(g.id, g.name) },
    h('span', { class: 'name' }, g.name), h('span', { class: 'sub' }, g.studio || g.provider));

  page.append(
    hero,
    h('div', { class: 'section-head' }, h('h2', 'Fantasy Originals'), h('span', { class: 'muted small' }, 'Our own games, seeded per bet')),
    h('div', { class: 'tiles' }, originals.map(tile)),
    providers.length ? [
      h('div', { class: 'section-head' }, h('h2', 'Slots'), h('a', { href: '/slots', class: 'small muted' }, 'See all')),
      h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' } }, providers.slice(0, 6).map(ptile)),
    ] : null,
    h('div', { class: 'section-head' }, h('h2', 'Live bets')),
    liveBetsTable(ctx));
  return () => { cancelAnimationFrame(raf); offs.forEach((f) => f()); };
}
