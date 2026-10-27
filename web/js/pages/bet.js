// Public bet page at /bet/:id: a shareable result card plus its fairness proof.
import { h, ICONS, copyText } from '../ui.js';
import { usd, mult, GAME_NAMES } from '../format.js';
import { useCss } from '../games/common.js';
import { avatar, playerLink, fmtDate, notFoundBlock } from './profile.js';
import { duelVerifyPanel, coinFace } from './duels.js';

const VERIFIABLE = new Set(['dice', 'limbo', 'coinflip', 'plinko', 'keno', 'wheel', 'roulette', 'baccarat', 'videopoker', 'mines', 'tower', 'hilo', 'blackjack']);
const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h4.6l4 5.6L17.4 4H20l-6.2 7.2L20.5 20h-4.6l-4.3-6-5.2 6H3.8l6.6-7.6z"/></svg>';
const multText = (m) => mult(m, m >= 1000 ? 0 : 2);

export async function render(page, { id }, ctx) {
  useCss('social');
  page.classList.add('so-page', 'so-bet-page');
  let b;
  try { b = await ctx.api.get(`/api/bets/${id}`); } catch (e) {
    page.append(e.status === 404 ? notFoundBlock('Bet not found', `There is no bet #${id}. The link may be mistyped.`) : notFoundBlock('Could not load this bet', e.message));
    return;
  }
  const game = GAME_NAMES[b.game] || b.game;
  const settled = b.status === 'settled';
  const won = settled && b.payout > b.amount;
  const push = settled && b.payout === b.amount && b.amount > 0;
  const state = b.status === 'active' ? 'live' : b.status === 'void' ? 'void' : won ? 'won' : push ? 'push' : 'lost';
  const brand = ctx.store.get('config')?.variant === 'arena' ? 'Fantasy Arena' : 'Fantasy Arcade';
  const url = `${location.origin}/bet/${b.id}`;

  const headline = {
    won: h('div', { class: 'so-bc-mult' }, multText(b.multiplier)),
    push: h('div', { class: 'so-bc-mult muted' }, multText(b.multiplier)),
    lost: h('div', { class: 'so-bc-mult dim' }, multText(b.multiplier || 0)),
    live: h('div', { class: 'so-bc-mult dim' }, 'In play'),
    void: h('div', { class: 'so-bc-mult dim' }, 'Void'),
  }[state];
  const payoutLine = {
    won: [h('span', { class: 'so-bc-pay win' }, usd(b.payout)), h('span', { class: 'muted' }, ` paid on ${usd(b.amount)}`)],
    push: [h('span', { class: 'so-bc-pay' }, usd(b.payout)), h('span', { class: 'muted' }, ' returned')],
    lost: [h('span', { class: 'so-bc-pay loss' }, usd(-b.amount)), h('span', { class: 'muted' }, ' stake lost')],
    live: [h('span', { class: 'so-bc-pay' }, usd(b.amount)), h('span', { class: 'muted' }, ' staked, still in play')],
    void: [h('span', { class: 'so-bc-pay' }, usd(b.amount)), h('span', { class: 'muted' }, ' refunded')],
  }[state];

  const card = h('article', { class: `so-betcard ${state}` },
    h('div', { class: 'so-bc-glow', 'aria-hidden': 'true' }),
    h('div', { class: 'so-bc-top' },
      h('span', { class: 'so-bc-game' }, game),
      h('span', { class: 'so-bc-id faint' }, `Bet #${b.id}`)),
    headline,
    h('div', { class: 'so-bc-payline' }, payoutLine),
    h('div', { class: 'so-bc-stats' },
      h('div', h('div', { class: 'k' }, 'Stake'), h('div', { class: 'v' }, usd(b.amount))),
      h('div', h('div', { class: 'k' }, 'Payout'), h('div', { class: 'v' }, settled || state === 'void' ? usd(b.payout) : '—')),
      h('div', h('div', { class: 'k' }, 'Multiplier'), h('div', { class: 'v' }, settled ? multText(b.multiplier) : '—'))),
    h('div', { class: 'so-bc-foot' },
      avatar(b.user, 'sm'),
      h('div', { class: 'so-bc-who' }, playerLink(b.user), h('span', { class: 'faint small' }, fmtDate(b.createdAt))),
      h('span', { class: 'so-bc-brand' }, brand)));

  const text = won ? `Hit ${multText(b.multiplier)} on ${game} at ${brand}` : `${game} bet #${b.id} at ${brand}`;
  const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const share = h('div', { class: 'so-share' },
    h('button', { class: 'btn btn-glass', type: 'button', onClick: () => copyText(url), html: `${ICONS.copy}<span>Copy link</span>` }),
    h('a', { class: 'btn btn-primary', href: tweet, target: '_blank', rel: 'noopener noreferrer', html: `${X_ICON}<span>Post on X</span>` }));

  const fair = h('section', { class: 'panel so-fair', 'aria-label': 'Fairness' }, h('h2', 'Fairness'));
  page.append(h('div', { class: 'so-bet-layout' }, h('div', { class: 'so-bet-main' }, card, share), fair));
  await fairness(fair, b, ctx);
}

const kv = (k, v) => h('div', { class: 'so-kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v mono' }, v));

async function fairness(box, b, ctx) {
  const f = b.fairness;
  if (f) {
    const link = f.serverSeed && VERIFIABLE.has(b.game)
      ? h('a', { class: 'btn', href: `/fairness?game=${b.game}&server=${f.serverSeed}&client=${encodeURIComponent(f.clientSeed)}&nonce=${f.nonce}&params=${encodeURIComponent(JSON.stringify(b.params))}`, html: `${ICONS.shield}<span>Verify on the fairness page</span>` })
      : null;
    box.append(
      kv('Client seed', f.clientSeed), kv('Nonce', String(f.nonce)), kv('Server seed hash', f.serverSeedHash),
      kv('Server seed', f.serverSeed || 'Hidden until the player rotates their seed pair'),
      link || h('p', { class: 'small muted' }, f.serverSeed ? 'Recompute this result with the seeds above.' : 'Once the seed is revealed you can recompute this result on the fairness page.'));
    return;
  }
  if (b.game === 'duel' && b.params?.duelId) {
    let d;
    try { d = await ctx.api.get(`/api/arena/duels/${b.params.duelId}`); } catch { d = null; }
    if (!d) { box.append(h('p', { class: 'small muted' }, 'The duel behind this bet could not be loaded.')); return; }
    box.append(h('div', { class: 'so-fair-duel' },
      h('span', { class: 'small muted' }, `Duel #${d.id}: `), coinFace(b.params.side), h('span', `${b.params.side[0].toUpperCase()}${b.params.side.slice(1)} `),
      d.result ? h('span', { class: 'muted' }, `· landed ${d.result}`) : null));
    const panel = h('div', { class: 'so-verify' });
    box.append(panel);
    await duelVerifyPanel(panel, d);
    return;
  }
  if (b.game === 'jackpot' && b.params?.roundId) {
    let r;
    try { r = await ctx.api.get(`/api/arena/jackpot/rounds/${b.params.roundId}`); } catch { r = null; }
    if (!r) { box.append(h('p', { class: 'small muted' }, `Jackpot round ${b.params.roundId}.`)); return; }
    box.append(kv('Round', `#${r.id}`), kv('Server seed hash', r.seedHash), kv('Server seed', r.serverSeed || 'Revealed when the round ends'),
      r.digest ? kv('Entries digest', r.digest) : null,
      h('p', { class: 'small muted' }, 'The winning ticket is HMAC-SHA256 of the round id and entries digest, keyed with the server seed.'));
    return;
  }
  if (b.game === 'crash') {
    box.append(h('p', { class: 'small muted' }, `Crash round ${b.params?.roundId ?? ''}: verify it from the round hash on the fairness page.`),
      h('a', { class: 'btn', href: '/fairness', html: `${ICONS.shield}<span>Verify on the fairness page</span>` }));
    return;
  }
  box.append(h('p', { class: 'small muted' }, 'This game is verified by its provider.'));
}
