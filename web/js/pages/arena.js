// Arena home: the live jackpot and open coinflip duels up top, live counters, today's
// top players and latest flips, the originals row, then live bets. Everything that
// moves is fed by the websocket.
import { h, clear, toast } from '../ui.js';
import { tileArt } from '../art.js';
import { usd } from '../format.js';
import { onWs, serverNow } from '../ws.js';
import { liveBetsTable } from '../livebets.js';
import { readRecent } from './lobby.js';
import { useCss, winFx } from '../games/common.js';
import { createPotRing } from '../arena/potring.js';
import { trackJackpot } from '../arena/feed.js';

// Small original coin faces: a gold sunburst for heads, a lilac crescent for tails.
const COIN = {
  heads: `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#ffd23f"/><circle cx="20" cy="20" r="15" fill="none" stroke="#b07a00" stroke-width="1.6" stroke-dasharray="1.6 2.4"/><circle cx="20" cy="20" r="7" fill="#b07a00"/><circle cx="18" cy="18" r="2.2" fill="#ffe27a"/></svg>`,
  tails: `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#c9b8ff"/><circle cx="20" cy="20" r="15" fill="none" stroke="#5a43a8" stroke-width="1.6" stroke-dasharray="1.6 2.4"/><circle cx="18" cy="20" r="9.5" fill="#5a43a8"/><circle cx="22.5" cy="17.5" r="8" fill="#c9b8ff"/></svg>`,
};
const nameEl = (user) => (user ? h('a', { href: `/u/${user}`, class: 'player-link' }, user) : h('span', { class: 'faint' }, 'Hidden'));

function strip(title, items, { hint } = {}) {
  if (!items.length) return null;
  const track = h('div', { class: 'strip-track' }, items);
  const page = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.9, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const arrow = (d) => `<svg viewBox="0 0 24 24"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const prev = h('button', { class: 'strip-btn', 'aria-label': `Scroll ${title} left`, onClick: () => page(-1), html: arrow('M15 6l-6 6 6 6') });
  const next = h('button', { class: 'strip-btn', 'aria-label': `Scroll ${title} right`, onClick: () => page(1), html: arrow('M9 6l6 6-6 6') });
  const sync = () => {
    prev.disabled = track.scrollLeft < 4;
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
  };
  track.addEventListener('scroll', sync, { passive: true });
  requestAnimationFrame(sync);
  return h('section', { class: 'strip' },
    h('div', { class: 'strip-head' }, h('h2', title), hint ? h('span', { class: 'muted small' }, hint) : null, h('div', { class: 'strip-actions' }, prev, next)),
    track);
}

export async function render(page, _p, ctx) {
  useCss('arena');
  page.classList.add('page-arena');
  const meId = () => ctx.store.get('me')?.id;
  const cfg = ctx.store.get('config') || {};

  // ---------- live jackpot ----------
  const ringHolder = h('a', { href: '/arena/jackpot', class: 'ah-ring', 'aria-label': 'Open the live jackpot' });
  const ring = createPotRing(ringHolder, { size: 250, compact: true });
  const nPot = h('div', { class: 'v' }, '$0.00'), nPlayers = h('div', { class: 'v' }, '0'), nTimer = h('div', { class: 'v timer' }, '—');
  const jpSub = h('p', { class: 'sub' }, 'One pot, one winner. Your chance is your share of the pot.');
  const jackpot = h('section', { class: 'ah-jackpot', 'aria-label': 'Live jackpot' },
    ringHolder,
    h('div', { class: 'ah-jp-copy' },
      h('div', { class: 'arena-kicker' }, h('span', { class: 'live-dot' }), 'Live jackpot'),
      h('h1', 'Winner takes the pot'),
      jpSub,
      h('div', { class: 'ah-jp-nums' },
        h('div', h('div', { class: 'k' }, 'Pot'), nPot),
        h('div', h('div', { class: 'k' }, 'Players'), nPlayers),
        h('div', h('div', { class: 'k' }, 'Draw'), nTimer)),
      h('div', { class: 'ah-jp-actions' },
        h('a', { href: '/arena/jackpot', class: 'btn btn-primary btn-lg' }, 'Join pot'),
        h('a', { href: '/arena/leaderboard', class: 'btn btn-glass btn-lg' }, 'Leaderboard'))));

  // ---------- open duels ----------
  const duelList = h('div', { class: 'ah-duel-list', 'aria-live': 'polite' });
  const duelPanel = h('section', { class: 'panel ah-duels', 'aria-label': 'Open coinflip duels' },
    h('div', { class: 'arena-head' }, h('h2', { class: 'arena-h' }, 'Open duels'), h('span', { class: 'small muted' }, 'Take one, flip instantly')),
    duelList,
    h('div', { class: 'ah-foot' },
      h('span', { class: 'small faint' }, `Winner takes both stakes minus ${+((cfg.duelRake ?? 0.025) * 100).toFixed(2)}%`),
      h('a', { href: '/arena/duels', class: 'btn btn-glass' }, 'See all duels')));

  // ---------- live counters ----------
  const counter = (k, live) => {
    const v = h('div', { class: 'v' }, '—');
    return { el: h('div', { class: 'ah-count' }, h('div', { class: 'k' }, live ? h('span', { class: 'live-dot' }) : null, k), v), v };
  };
  const cOnline = counter('Players online', true), cTable = counter('On the table'), cDuels = counter('Open duels'), cLive = counter('Wagered since you arrived');
  const flash = (c, text) => {
    if (c.v.textContent === text) return;
    c.v.textContent = text;
    c.v.classList.remove('flash'); void c.v.offsetWidth; c.v.classList.add('flash');
  };

  // ---------- leaderboard + latest flips ----------
  const board = h('div', { class: 'ah-board' }, h('p', { class: 'muted' }, 'Loading'));
  const flips = h('div', { class: 'ah-recent' });
  const mid = h('div', { class: 'ah-mid' },
    h('section', { class: 'panel' },
      h('div', { class: 'arena-head' }, h('h2', { class: 'arena-h' }, 'Top players today'), h('a', { href: '/arena/leaderboard', class: 'small muted' }, 'Full leaderboard')),
      board),
    h('section', { class: 'panel' },
      h('div', { class: 'arena-head' }, h('h2', { class: 'arena-h' }, 'Latest flips'), h('a', { href: '/arena/duels', class: 'small muted' }, 'Duels')),
      flips));

  // ---------- originals ----------
  const { originals } = await ctx.api.get('/api/games').catch(() => ({ originals: [] }));
  const recent = readRecent();
  const rank = (id) => { const i = recent.indexOf(id); return i < 0 ? 1e3 : i; };
  const sorted = [...originals].sort((a, b) => rank(a.id) - rank(b.id));
  const tile = (g) => h('a', { class: 'tile', href: `/casino/${g.id}`, 'data-name': g.name.toLowerCase(), html: tileArt(g.id) },
    h('span', { class: 'tile-name' }, g.name), h('span', { class: 'tile-sub' }, 'Fantasy original'));

  page.append(
    h('div', { class: 'ah-top' }, jackpot, duelPanel),
    h('div', { class: 'ah-pulse' }, cOnline.el, cTable.el, cDuels.el, cLive.el),
    mid,
    ...[strip('Fantasy Originals', sorted.map(tile), { hint: 'House games, every result verifiable' }),
      h('section', { class: 'strip ah-live' }, h('div', { class: 'strip-head' }, h('h2', 'Live bets')), liveBetsTable(ctx))].filter(Boolean));

  // ---------- state ----------
  let jround = null, spinning = false, raf = 0, openDuels = [], liveWagered = 0;
  const taking = new Set();

  function paintJackpot() {
    const r = jround;
    nPot.textContent = usd(r?.pot || 0);
    nPlayers.textContent = String(r?.players?.length || 0);
    if (spinning || r?.status === 'drawing') { nTimer.textContent = 'Drawing'; nTimer.classList.remove('urgent'); }
    else if (r?.status === 'countdown') {
      const left = Math.max(0, r.endsAt - serverNow());
      nTimer.textContent = `${Math.ceil(left / 1000)}s`;
      nTimer.classList.toggle('urgent', left < 5000);
    } else { nTimer.textContent = r?.status === 'open' ? 'Waiting' : r ? 'Next soon' : '—'; nTimer.classList.remove('urgent'); }
    raf = requestAnimationFrame(paintJackpot);
  }
  raf = requestAnimationFrame(paintJackpot);
  const paintTable = () => {
    flash(cDuels, String(openDuels.length));
    flash(cTable, usd((jround && !jround.result ? jround.pot : 0) + openDuels.reduce((a, d) => a + d.amount, 0), { compact: true }));
  };

  const feed = trackJackpot(ctx, {
    onRound(r) {
      if (spinning && r.id === jround?.id) return;
      jround = r;
      ring.update(r, meId());
      jpSub.textContent = r.status === 'open'
        ? (r.players.length ? `${r.players[0].user || 'A hidden player'} is waiting for a challenger.` : 'The pot is empty. First in sets the table.')
        : r.status === 'countdown' ? `${r.players.length} players are in. Get in before the draw.` : 'One pot, one winner. Your chance is your share of the pot.';
      paintTable();
    },
    async onDraw(r, spinMs, { late, ended } = {}) {
      jround = r;
      paintTable();
      if (ended) { ring.showLanded(r); return; }
      spinning = true;
      jpSub.textContent = 'Drawing the winner';
      await ring.spinTo(r, late ? Math.min(spinMs, 1400) : Math.max(1500, spinMs - 400));
      spinning = false;
      feed.release();
      const res = r.result;
      jpSub.textContent = `${res.winner || 'A hidden player'} won ${usd(res.payout)} with a ${(res.chance * 100).toFixed(1)}% chance.`;
      const mine = (r.players || []).find((p) => p.userId === meId());
      if (mine && res.winnerId === meId()) winFx(res.payout / mine.amount, res.payout);
    },
    onHistory(_list, { ended } = {}) { if (ended) loadBoard(); },
  });

  // ---------- duels ----------
  const sideLabel = (d) => `You get ${d.creatorSide === 'heads' ? 'tails' : 'heads'}`;
  function duelRow(d, fresh) {
    const mine = d.creatorId === meId();
    const btn = h('button', { class: 'btn btn-primary', type: 'button', disabled: mine || taking.has(d.id), 'aria-label': mine ? 'Your own duel' : `Take ${usd(d.amount)} duel`, onClick: () => take(d, btn) }, mine ? 'Yours' : 'Take');
    return h('div', { class: `ah-duel ${fresh ? 'enter' : ''}`, 'data-id': d.id },
      h('span', { class: 'coin', html: COIN[d.creatorSide === 'heads' ? 'tails' : 'heads'], title: `You would be ${d.creatorSide === 'heads' ? 'tails' : 'heads'}` }),
      h('span', { class: 'who' }, nameEl(d.creator), h('span', { class: 'side' }, mine ? 'Your duel' : sideLabel(d))),
      h('span', { class: 'amt' }, usd(d.amount)),
      btn);
  }
  let shown = null;
  function renderDuels(freshId) {
    const top = [...openDuels].sort((a, b) => b.amount - a.amount || b.id - a.id).slice(0, 5);
    const ids = top.map((d) => d.id).join();
    if (shown && ids === shown.join() && freshId === undefined) return;
    shown = top.map((d) => d.id);
    clear(duelList, top.length ? top.map((d) => duelRow(d, d.id === freshId)) : h('div', { class: 'ah-empty' },
      h('span', 'No open duels right now.'),
      h('a', { href: '/arena/duels', class: 'btn btn-glass' }, 'Start a duel')));
    paintTable();
  }
  async function take(d, btn) {
    if (!ctx.requireAuth()) return;
    if (d.amount > ctx.store.get('balance')) return toast('Not enough balance to take this duel', 'error');
    taking.add(d.id);
    btn.disabled = true;
    btn.textContent = 'Flipping';
    const r = await ctx.attempt(() => ctx.api.post(`/api/arena/duels/${d.id}/join`, {}));
    taking.delete(d.id);
    if (!r) { btn.disabled = false; btn.textContent = 'Take'; return; }
    if (!ctx.store.get('balanceHold')) ctx.store.set('balance', r.balance);
    const won = r.duel.winnerId === meId();
    toast(won ? `It landed ${r.duel.result}. You won ${usd(r.duel.payout)}` : `It landed ${r.duel.result}. ${r.duel.creator || 'The creator'} takes this one`, won ? 'success' : 'info');
    if (won) winFx(r.duel.payout / r.duel.amount, r.duel.payout);
  }
  function addFlip(d, fresh) {
    const winner = d.winnerId === d.creatorId ? d.creator : d.joiner;
    const row = h('div', { class: `ah-rrow ${fresh ? 'enter' : ''}` },
      h('span', { class: 'coin', html: COIN[d.result] || COIN.heads }),
      h('span', { class: 'txt' }, nameEl(winner), h('span', { class: 'muted' }, ' beat '), nameEl(d.winnerId === d.creatorId ? d.joiner : d.creator)),
      h('span', { class: 'win', style: { fontWeight: 700 } }, `+${usd(d.payout)}`));
    if (fresh) flips.prepend(row); else flips.append(row);
    flips.querySelector('.muted-empty')?.remove();
    while (flips.children.length > 5) flips.lastChild.remove();
  }
  ctx.api.get('/api/arena/duels').then((r) => {
    openDuels = r.open || [];
    renderDuels();
    clear(flips);
    (r.recent || []).slice(0, 5).forEach((d) => addFlip(d, false));
    if (!flips.children.length) flips.append(h('p', { class: 'muted muted-empty' }, 'No flips yet today.'));
  }).catch(() => renderDuels());

  const removeDuel = (id) => {
    const el = duelList.querySelector(`[data-id="${id}"]`);
    openDuels = openDuels.filter((d) => d.id !== id);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (el && !reduce) { el.classList.add('leave'); setTimeout(() => renderDuels(), 280); } else renderDuels();
  };

  // ---------- leaderboard ----------
  async function loadBoard() {
    const r = await ctx.api.get('/api/arena/leaderboard?period=day').catch(() => null);
    if (!r) return;
    const rows = r.rows.slice(0, 5);
    clear(board, rows.length ? rows.map((x, i) => h('div', { class: 'ah-brow' },
      h('span', { class: 'rank' }, String(i + 1)),
      h('span', { class: 'who' }, nameEl(x.user), h('span', { class: 'meta' }, `${x.vip} · ${x.wins} of ${x.games} won`)),
      h('span', { class: `profit ${x.profit > 0 ? 'win' : x.profit < 0 ? 'loss' : 'faint'}` }, usd(x.profit, { sign: true }))))
      : h('p', { class: 'muted' }, 'Nobody has played a jackpot or duel today. The top spot is open.'));
  }
  loadBoard();
  const boardTimer = setInterval(loadBoard, 60000);

  // ---------- online ----------
  const loadOnline = () => ctx.api.get('/api/public/stats').then((s) => flash(cOnline, String(s.online))).catch(() => {});
  setTimeout(loadOnline, 1200);
  const onlineTimer = setInterval(loadOnline, 30000);
  cLive.v.textContent = usd(0);

  const offs = [
    onWs('duel:open', (m) => { openDuels = [...openDuels.filter((d) => d.id !== m.duel.id), m.duel]; renderDuels(m.duel.id); }),
    onWs('duel:result', (m) => { removeDuel(m.duel.id); addFlip(m.duel, true); setTimeout(loadBoard, 400); }),
    onWs('duel:cancel', (m) => removeDuel(m.id)),
    onWs('bet', (m) => { liveWagered += m.bet.amount || 0; flash(cLive, usd(liveWagered, { compact: true })); }),
    ctx.store.on('me', () => { shown = null; renderDuels(); }),
  ];

  return () => {
    cancelAnimationFrame(raf);
    clearInterval(boardTimer); clearInterval(onlineTimer);
    feed.stop(); ring.destroy();
    offs.forEach((f) => f());
  };
}
