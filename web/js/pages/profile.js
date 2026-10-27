// Public player profile at /u/:username. Also exports the small player helpers
// (avatar, player link) the other social pages share.
import { h, clear, ICONS, copyText } from '../ui.js';
import { usd, mult, ago, GAME_NAMES } from '../format.js';
import { useCss } from '../games/common.js';

// ---------- shared helpers ----------
const PALETTE = [['#ff2e88', '#5c0f33'], ['#29d8ff', '#0b3f52'], ['#3ee08f', '#0c4029'], ['#ffd23f', '#4d3b00'], ['#b78bff', '#2e1d57'], ['#ff8a3d', '#4f2306']];
function hashStr(s) {
  let x = 2166136261;
  for (const c of s) { x ^= c.codePointAt(0); x = Math.imul(x, 16777619); }
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
  return x >>> 0;
}

// A geometric badge generated from the name: a tinted tile with a 3x3 mirrored pattern.
export function avatar(name, size = 'md') {
  if (!name) return h('span', { class: `so-avatar ${size} anon`, 'aria-hidden': 'true', html: '<svg viewBox="0 0 30 30"><circle cx="15" cy="12" r="5" fill="currentColor"/><path d="M6 26c1-5 5-7 9-7s8 2 9 7z" fill="currentColor"/></svg>' });
  const n = hashStr(name.toLowerCase());
  const [fg, bg] = PALETTE[n % PALETTE.length];
  let cells = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
    if ((n >> (3 + r * 2 + c)) & 1) {
      const xs = c === 0 ? [0, 2] : [1];
      for (const x of xs) cells += `<rect x="${5 + x * 7}" y="${5 + r * 7}" width="6" height="6" rx="1.5" fill="${fg}"/>`;
    }
  }
  if (!cells) cells = `<rect x="12" y="12" width="6" height="6" rx="1.5" fill="${fg}"/>`;
  return h('span', { class: `so-avatar ${size}`, 'aria-hidden': 'true', html: `<svg viewBox="0 0 30 30"><rect width="30" height="30" fill="${bg}"/>${cells}</svg>` });
}
export const playerLink = (name, cls = '') => (name
  ? h('a', { class: `player-link ${cls}`, href: `/u/${encodeURIComponent(name)}` }, name)
  : h('span', { class: `so-hidden-name ${cls}` }, 'Hidden'));
export const fmtDate = (ts) => new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
export const winRate = (won, played) => (played ? `${Math.round((won / played) * 100)}%` : '—');
export const tierClass = (vip) => `so-tier t-${String(vip || '').toLowerCase().replace(/[^a-z]+/g, '-')}`;
export const tier = (vip) => (vip ? h('span', { class: tierClass(vip) }, vip) : null);

export function notFoundBlock(title, text) {
  return h('div', { class: 'so-empty-state panel' },
    h('div', { class: 'so-empty-mark', html: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="6 7"/><path d="M24 26h.01M40 26h.01" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><path d="M23 44c5-4 13-4 18 0" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>' }),
    h('h1', title), h('p', { class: 'muted' }, text), h('a', { class: 'btn btn-primary', href: '/' }, 'Back to the arena'));
}

// ---------- page ----------
export async function render(page, { username }, ctx) {
  useCss('social');
  page.classList.add('so-page');
  let p;
  try { p = await ctx.api.get(`/api/users/${encodeURIComponent(username)}`); } catch (e) {
    page.append(e.status === 404
      ? notFoundBlock('Player not found', `Nobody here goes by ${username}. Check the spelling, or find players on the leaderboard.`)
      : notFoundBlock('Could not load this profile', e.message));
    return;
  }
  const me = ctx.store.get('me');
  const own = me && me.username.toLowerCase() === p.username.toLowerCase();

  if (p.hidden && !own) {
    page.append(h('div', { class: 'so-empty-state panel' },
      h('div', { class: 'so-empty-mark', html: ICONS.lock }),
      h('h1', p.username), h('p', { class: 'muted' }, 'This player keeps their profile private.'),
      h('a', { class: 'btn btn-glass', href: '/arena/leaderboard' }, 'See the leaderboard')));
    return;
  }

  const share = h('button', { class: 'btn btn-glass', type: 'button', onClick: () => copyText(`${location.origin}/u/${p.username}`), html: `${ICONS.copy}<span>Share profile</span>` });
  page.append(h('header', { class: 'so-profile-head panel' },
    avatar(p.username, 'xl'),
    h('div', { class: 'so-profile-id' },
      h('h1', p.username),
      h('div', { class: 'so-profile-meta' }, tier(p.vip), h('span', { class: 'muted small' }, `Joined ${fmtDate(p.joinedAt)}`))),
    share));

  if (own) {
    page.append(h('div', { class: 'notice so-own-note' },
      p.hidden ? 'Your profile is private. Only you can see these stats. ' : 'This is your public profile. Anyone with the link can see it. ',
      h('a', { href: '/settings' }, p.hidden ? 'Make it public in settings' : 'Change privacy in settings')));
  }

  const pvp = p.pvp;
  const tile = (k, v, sub, cls = '') => h('div', { class: `so-tile ${cls}` }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub ? h('div', { class: 'sub' }, sub) : null);
  const big = p.biggestWin;
  page.append(h('section', { class: 'so-tiles', 'aria-label': 'Stats' },
    tile('Wagered', usd(p.wagered, { compact: true })),
    tile('Bets', p.bets.toLocaleString('en-US')),
    big
      ? h('a', { class: 'so-tile link', href: `/bet/${big.id}` }, h('div', { class: 'k' }, 'Biggest win'), h('div', { class: 'v accent' }, mult(big.multiplier)),
        h('div', { class: 'sub' }, `${usd(big.payout)} on ${GAME_NAMES[big.game] || big.game}`))
      : tile('Biggest win', '—', 'No wins yet'),
    tile('PvP net', usd(pvp.net, { sign: true }), null, pvp.net > 0 ? 'pos' : pvp.net < 0 ? 'neg' : ''),
    tile('Jackpot', `${pvp.jackpotWon} / ${pvp.jackpotPlayed}`, pvp.jackpotPlayed ? `Won ${winRate(pvp.jackpotWon, pvp.jackpotPlayed)} of rounds` : 'Rounds won / played'),
    tile('Duels', `${pvp.duelsWon} / ${pvp.duelsPlayed}`, pvp.duelsPlayed ? `${winRate(pvp.duelsWon, pvp.duelsPlayed)} win rate` : 'Duels won / played')));

  const list = h('div', { class: 'so-bets' });
  if (!p.recent.length) list.append(h('p', { class: 'muted so-empty-line' }, own ? 'No settled bets yet. Take a duel to get started.' : 'No settled bets yet.'));
  for (const b of p.recent) {
    const won = b.payout > b.amount;
    list.append(h('a', { class: 'so-bet-row', href: `/bet/${b.id}` },
      h('span', { class: 'so-bet-game' }, GAME_NAMES[b.game] || b.game),
      h('span', { class: 'faint small so-bet-when' }, ago(b.at)),
      h('span', { class: 'so-bet-amt' }, usd(b.amount)),
      h('span', { class: `so-bet-mult ${won ? 'win' : 'faint'}` }, mult(b.multiplier)),
      h('span', { class: `so-bet-profit ${won ? 'win' : b.payout < b.amount ? 'loss' : 'faint'}` }, usd(b.payout - b.amount, { sign: true }))));
  }
  page.append(h('section', { class: 'so-recent' },
    h('div', { class: 'so-section-head' }, h('h2', 'Recent bets')),
    h('div', { class: 'panel so-bets-panel' },
      p.recent.length ? h('div', { class: 'so-bet-row head' }, h('span', 'Game'), h('span', { class: 'so-bet-when' }, 'When'), h('span', { class: 'so-bet-amt' }, 'Stake'), h('span', { class: 'so-bet-mult' }, 'Multiplier'), h('span', { class: 'so-bet-profit' }, 'Profit')) : null,
      list)));
}
