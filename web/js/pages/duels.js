// Coinflip duels: create a duel, take someone else's, watch the flip, verify the result.
import { h, clear, toast } from '../ui.js';
import { usd, ago } from '../format.js';
import { onWs } from '../ws.js';
import { amountField } from '../betpanel.js';
import { useCss, winFx, sleep } from '../games/common.js';
import { avatar, playerLink } from './profile.js';

const MAX_OPEN = 5;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const other = (s) => (s === 'heads' ? 'tails' : 'heads');
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Original duel coin faces: heads is a magenta coin with a four-point spark,
// tails is a cyan coin with a lightning bolt.
const FACES = {
  heads: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="49" fill="#8f0c47"/><circle cx="50" cy="50" r="45" fill="#ff2e88"/>
    <circle cx="50" cy="50" r="37" fill="none" stroke="#ffc2dd" stroke-width="2.5" stroke-dasharray="1 6" stroke-linecap="round"/>
    <path d="M50 22 C53 42 58 47 78 50 C58 53 53 58 50 78 C47 58 42 53 22 50 C42 47 47 42 50 22Z" fill="#fff4f9"/>
    <circle cx="50" cy="50" r="5" fill="#ff2e88"/></svg>`,
  tails: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="49" fill="#0a6f8c"/><circle cx="50" cy="50" r="45" fill="#29d8ff"/>
    <circle cx="50" cy="50" r="37" fill="none" stroke="#d2f6ff" stroke-width="2.5" stroke-dasharray="1 6" stroke-linecap="round"/>
    <path d="M56 20 L32 55 H48 L42 80 L68 43 H52 Z" fill="#06283a" stroke="#06283a" stroke-width="3" stroke-linejoin="round"/></svg>`,
};
export const coinFace = (side, cls = '') => h('span', { class: `so-face-mini ${cls}`, html: FACES[side], title: cap(side) });

// ---------- verification (shared with the bet page) ----------
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function recomputeDuel(d) {
  const key = await crypto.subtle.importKey('raw', enc.encode(d.serverSeed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = `${d.id}:${d.creatorId}:${d.joinerId}`;
  const digest = hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  const float = parseInt(digest.slice(0, 13), 16) / 2 ** 52;
  const result = float < 0.5 ? 'heads' : 'tails';
  const hash = hex(await crypto.subtle.digest('SHA-256', enc.encode(d.serverSeed)));
  return { message, digest, float, result, hashOk: hash === d.seedHash, resultOk: result === d.result };
}
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const kv = (k, v, mono = true) => h('div', { class: 'so-kv' }, h('span', { class: 'k' }, k), h('span', { class: `v ${mono ? 'mono' : ''}` }, v));
const check = (ok, yes, no) => h('div', { class: `so-check ${ok ? 'ok' : 'bad'}`, role: 'status' }, h('span', { class: 'ic', html: ok ? CHECK : CROSS }), ok ? yes : no);

// Fills `box` with the seed details and an in-browser recompute of the flip.
export async function duelVerifyPanel(box, d) {
  if (!d.serverSeed) {
    clear(box, kv('Seed hash', d.seedHash), h('p', { class: 'small muted' }, 'The server seed is revealed once the duel is settled.'));
    return;
  }
  clear(box, h('p', { class: 'small muted' }, 'Recomputing in your browser…'));
  if (!crypto?.subtle) { clear(box, h('p', { class: 'small loss' }, 'This browser cannot run the check (WebCrypto needs a secure connection).')); return; }
  const r = await recomputeDuel(d);
  clear(box,
    kv('Seed hash (shown at creation)', d.seedHash),
    kv('Server seed (revealed)', d.serverSeed),
    kv('Message', r.message),
    kv('HMAC-SHA256', r.digest),
    kv('First 13 hex as a fraction', `${r.float.toFixed(8)} ${r.float < 0.5 ? '< 0.5, heads' : '≥ 0.5, tails'}`, false),
    h('div', { class: 'so-checks' },
      check(r.hashOk, 'Seed matches its hash', 'Seed does not match its hash'),
      check(r.resultOk, `Recomputed ${r.result}: match`, `Recomputed ${r.result}, recorded ${d.result}: mismatch`)));
}

// ---------- the coin ----------
function makeCoin(size = '') {
  const coin = h('div', { class: 'so-coin' },
    h('div', { class: 'so-face heads', html: FACES.heads }),
    h('div', { class: 'so-face tails', html: FACES.tails }));
  const toss = h('div', { class: 'so-toss' }, coin);
  const el = h('div', { class: `so-coin-stage ${size}` }, toss, h('div', { class: 'so-coin-shadow' }));
  let turns = 0;
  return {
    el,
    show(side) { coin.style.transition = 'none'; turns = side === 'tails' ? 180 : 0; coin.style.transform = `rotateX(${turns}deg)`; },
    async flip(side) {
      const base = Math.ceil(turns / 360) * 360;
      turns = base + 360 * 5 + (side === 'tails' ? 180 : 0);
      if (reduced()) { coin.style.transition = 'none'; coin.style.transform = `rotateX(${turns}deg)`; await sleep(250); return; }
      void coin.offsetWidth;
      coin.style.transition = '';
      el.classList.remove('landed');
      el.classList.add('tossing');
      coin.style.transform = `rotateX(${turns}deg)`;
      await sleep(1700);
      el.classList.remove('tossing');
      el.classList.add('landed');
    },
  };
}

export async function render(page, _params, ctx) {
  useCss('social');
  const cfg = ctx.store.get('config') || {};
  const rake = cfg.duelRake ?? 0.025;
  const minBet = cfg.pvpMinBet ?? 100000;
  const payoutFor = (amount) => Math.floor(2 * amount * (1 - rake));
  const me = () => ctx.store.get('me');
  const offs = [];
  const timers = [];
  let alive = true;

  page.classList.add('so-page');
  page.append(h('header', { class: 'so-head' },
    h('h1', 'Coinflip duels'),
    h('p', { class: 'muted' }, `Pick a side and set a stake. The first player to take your duel gets the other side, and the winner takes both stakes minus a ${(rake * 100).toFixed(1)}% rake.`)));

  let data;
  try { data = await ctx.api.get('/api/arena/duels'); } catch (e) {
    page.append(h('div', { class: 'panel so-empty-state' }, h('h2', 'Duels are not available'), h('p', { class: 'muted' }, e.status === 404 ? 'Duels run on Fantasy Arena only.' : e.message)));
    return;
  }

  // ---------- create panel ----------
  const amt = amountField(Math.max(1, minBet / 1e6));
  let side = 'heads';
  const pick = h('div', { class: 'so-pick', role: 'radiogroup', 'aria-label': 'Your side' },
    ['heads', 'tails'].map((s) => h('button', { type: 'button', role: 'radio', class: 'so-pick-btn', 'data-side': s, onClick: () => choose(s) },
      h('span', { class: 'so-pick-coin', html: FACES[s] }), h('span', { class: 'so-pick-label' }, cap(s)))));
  const winLine = h('p', { class: 'so-winline' });
  const openCount = h('p', { class: 'small faint' });
  const createBtn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onClick: create }, 'Create duel');
  const createPanel = h('section', { class: 'panel so-create', 'aria-label': 'Create a duel' },
    h('h2', 'New duel'), amt.el,
    h('div', { class: 'field' }, h('span', { class: 'small muted' }, 'Your side'), pick),
    winLine, createBtn, openCount);
  function choose(s) {
    side = s;
    pick.querySelectorAll('button').forEach((b) => { const on = b.dataset.side === s; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  }
  const updateWin = () => {
    const a = amt.units;
    clear(winLine, a >= minBet
      ? [h('span', 'You win '), h('strong', usd(payoutFor(a))), h('span', ' if you win')]
      : h('span', { class: 'faint' }, `Minimum stake ${usd(minBet)}`));
  };
  amt.input.addEventListener('input', updateWin);
  choose('heads');
  updateWin();

  async function create() {
    if (!ctx.requireAuth()) return;
    const amount = amt.units;
    if (amount < minBet) { toast(`Minimum stake is ${usd(minBet)}`, 'error'); return; }
    createBtn.disabled = true;
    const r = await ctx.attempt(() => ctx.api.post('/api/arena/duels', { amount, side }));
    createBtn.disabled = false;
    if (!r) return;
    ctx.store.set('balance', r.balance);
    addOpen(r.duel, true);
    toast('Duel created. Waiting for a challenger', 'success');
  }

  // ---------- open duels ----------
  const grid = h('div', { class: 'so-grid', 'aria-live': 'polite' });
  const emptyOpen = h('div', { class: 'so-empty' },
    h('span', { class: 'so-empty-coins' }, coinFace('heads'), coinFace('tails')),
    h('p', 'No open duels right now. Create one and someone will take you on.'));
  const openHead = h('span', { class: 'small faint' });
  const openSection = h('section', { class: 'so-open' },
    h('div', { class: 'so-section-head' }, h('h2', 'Open duels'), openHead), grid, emptyOpen);

  const cards = new Map();
  function cardFor(d) {
    const mine = me()?.id === d.creatorId;
    const take = other(d.creatorSide);
    const btn = mine
      ? h('button', { class: 'btn btn-glass btn-block', type: 'button', onClick: () => cancel(d, btn) }, 'Cancel')
      : h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: () => join(d, btn) }, `Take ${take} for ${usd(d.amount)}`);
    return h('article', { class: `so-card ${mine ? 'mine' : ''}`, 'data-id': d.id },
      h('div', { class: 'so-card-top' },
        avatar(d.creator, 'sm'),
        h('div', { class: 'so-card-who' }, playerLink(d.creator), h('span', { class: 'faint small', 'data-ts': d.createdAt }, ago(d.createdAt))),
        mine ? h('span', { class: 'so-badge' }, 'Yours') : null),
      h('div', { class: 'so-card-mid' },
        h('span', { class: 'so-card-coin', html: FACES[d.creatorSide] }),
        h('div', h('div', { class: 'so-stake' }, usd(d.amount)), h('div', { class: 'small muted' }, `Picked ${d.creatorSide}`))),
      btn);
  }
  const sortKey = (d) => [d.amount, d.id];
  function addOpen(d, animate) {
    if (cards.has(d.id)) return;
    const el = cardFor(d);
    el._duel = d;
    if (animate && !reduced()) el.classList.add('so-enter');
    const [a, i] = sortKey(d);
    const before = [...cards.values()].find((c) => c._duel.amount < a || (c._duel.amount === a && c._duel.id < i));
    grid.insertBefore(el, before || null);
    cards.set(d.id, el);
    syncOpen();
  }
  function removeOpen(id, kind = 'taken') {
    const el = cards.get(id);
    if (!el) return;
    cards.delete(id);
    if (reduced()) el.remove();
    else {
      el.classList.add('so-leave', kind === 'cancel' ? 'so-leave-cancel' : 'so-leave-taken');
      setTimeout(() => el.remove(), 420);
    }
    syncOpen();
  }
  function syncOpen() {
    emptyOpen.classList.toggle('hidden', cards.size > 0);
    openHead.textContent = cards.size ? `${cards.size} waiting` : '';
    const mine = [...cards.values()].filter((c) => c._duel.creatorId === me()?.id).length;
    openCount.textContent = me() ? `${mine} of ${MAX_OPEN} open duels used` : '';
  }
  function rerenderCards() {
    for (const [id, el] of cards) { const n = cardFor(el._duel); n._duel = el._duel; el.replaceWith(n); cards.set(id, n); }
    syncOpen();
  }

  async function cancel(d, btn) {
    btn.disabled = true;
    const r = await ctx.attempt(() => ctx.api.post(`/api/arena/duels/${d.id}/cancel`));
    if (!r) { btn.disabled = false; return; }
    ctx.store.set('balance', r.balance);
    removeOpen(d.id, 'cancel');
    toast(`Duel cancelled, ${usd(d.amount)} returned`, 'success');
  }

  // ---------- balance hold while a flip plays ----------
  let latestBal = null;
  offs.push(onWs('balance', (m) => { latestBal = m.balance; }));
  const hold = () => { latestBal = null; ctx.store.set('balanceHold', true); };
  const release = (fallback) => {
    ctx.store.set('balanceHold', false);
    const b = latestBal ?? fallback;
    if (b !== undefined && b !== null) ctx.store.set('balance', b);
  };

  async function join(d, btn) {
    if (!ctx.requireAuth()) return;
    if (busy) { toast('Finish watching the current flip first'); return; }
    btn.disabled = true;
    busy = true;
    hold();
    let r;
    try { r = await ctx.api.post(`/api/arena/duels/${d.id}/join`); } catch (e) {
      busy = false;
      release();
      if (e.code === 'duel_taken') { toast('Someone else took this duel first', 'error'); removeOpen(d.id); } else { toast(e.message, 'error'); btn.disabled = false; }
      return;
    }
    // Show the stake leaving now; the payout (if any) appears when the coin lands.
    ctx.store.set('balance', r.balance - (r.duel.winnerId === me()?.id ? r.duel.payout : 0));
    removeOpen(d.id);
    addRecent(r.duel, true);
    await showFlip(r.duel, () => release(r.balance));
    busy = false;
    drainQueue();
  }

  // ---------- flip overlay ----------
  let busy = false;
  const queue = [];
  let overlay = null;
  function closeOverlay() { overlay?.remove(); overlay = null; document.removeEventListener('keydown', onKey); }
  const onKey = (e) => e.key === 'Escape' && overlay?.dataset.done && closeOverlay();

  function showFlip(d, onLanded) {
    closeOverlay();
    const meId = me()?.id;
    const coin = makeCoin('lg');
    coin.show(d.creatorSide);
    const seat = (name, s, id) => h('div', { class: 'so-seat', 'data-uid': id },
      avatar(name, 'md'), h('div', { class: 'so-seat-name' }, id === meId ? 'You' : playerLink(name)),
      h('div', { class: 'so-seat-side' }, coinFace(s), cap(s)));
    const left = seat(d.creator, d.creatorSide, d.creatorId);
    const right = seat(d.joiner, other(d.creatorSide), d.joinerId);
    const status = h('div', { class: 'so-flip-status', role: 'status', 'aria-live': 'polite' }, 'Flipping…');
    const sub = h('div', { class: 'so-flip-sub muted' }, `Duel #${d.id} · ${usd(d.amount)} each · pot ${usd(payoutFor(d.amount))}`);
    const done = h('button', { class: 'btn btn-glass', type: 'button', disabled: true, onClick: closeOverlay }, 'Done');
    const intro = d.creatorId === meId && d.joinerId !== meId ? h('div', { class: 'so-flip-intro' }, d.joiner ? [playerLink(d.joiner), ' took your duel'] : 'A hidden player took your duel') : null;
    overlay = h('div', { class: 'overlay so-flip-overlay', onClick: (e) => e.target === overlay && overlay.dataset.done && closeOverlay() },
      h('div', { class: 'so-flip', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Duel #${d.id} flip` },
        intro,
        h('div', { class: 'so-flip-row' }, left, h('div', { class: 'so-flip-mid' }, coin.el), right),
        status, sub, h('div', { class: 'so-flip-actions' }, done)));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    return (async () => {
      await sleep(reduced() ? 150 : 450);
      await coin.flip(d.result);
      if (!alive && !overlay) return;
      const won = d.winnerId === meId;
      const inDuel = meId === d.creatorId || meId === d.joinerId;
      const winnerSeat = d.winnerId === d.creatorId ? left : right;
      const loserSeat = winnerSeat === left ? right : left;
      winnerSeat.classList.add('won');
      loserSeat.classList.add('lost');
      status.classList.add(inDuel ? (won ? 'win' : 'loss') : 'neutral');
      status.textContent = inDuel ? (won ? `${cap(d.result)}. You won ${usd(d.payout)}` : `${cap(d.result)}. You lost ${usd(d.amount)}`) : `${cap(d.result)} wins`;
      onLanded?.();
      if (won) winFx(d.payout / d.amount, d.payout);
      overlay && (overlay.dataset.done = '1');
      done.disabled = false;
      done.focus();
    })();
  }
  async function drainQueue() {
    if (busy || !queue.length || !alive) return;
    const d = queue.shift();
    busy = true;
    // The payout push lands before duel:result on the same socket, so the balance
    // already includes the win; show it without the payout until the coin lands.
    const final = ctx.store.get('balance');
    hold();
    if (d.winnerId === me()?.id) ctx.store.set('balance', final - d.payout);
    await showFlip(d, () => release(final));
    busy = false;
    drainQueue();
  }

  // ---------- recent results ----------
  const recentList = h('div', { class: 'so-recent-list' });
  const emptyRecent = h('p', { class: 'muted so-empty-line' }, 'No duels settled yet.');
  const recentSection = h('section', { class: 'so-recent' },
    h('div', { class: 'so-section-head' }, h('h2', 'Recent results')), h('div', { class: 'panel so-recent-panel' }, recentList, emptyRecent));
  const recentIds = new Set();
  function recentRow(d) {
    const box = h('div', { class: 'so-verify hidden' });
    let opened = false;
    const toggle = h('button', { class: 'btn btn-ghost so-verify-btn', type: 'button', 'aria-expanded': 'false', onClick: async () => {
      opened = !opened;
      toggle.setAttribute('aria-expanded', String(opened));
      toggle.textContent = opened ? 'Hide' : 'Verify';
      box.classList.toggle('hidden', !opened);
      if (opened && !box.childElementCount) await duelVerifyPanel(box, d);
    } }, 'Verify');
    const p = (name, id, s) => h('div', { class: `so-rp ${d.winnerId === id ? 'won' : ''}` }, coinFace(s), playerLink(name));
    return h('div', { class: 'so-rrow', 'data-id': d.id },
      h('div', { class: 'so-rrow-main' },
        h('div', { class: 'so-rplayers' }, p(d.creator, d.creatorId, d.creatorSide), h('span', { class: 'faint small' }, 'vs'), p(d.joiner, d.joinerId, other(d.creatorSide))),
        h('div', { class: 'so-rstake' }, h('span', { class: 'faint small' }, 'Stake '), usd(d.amount)),
        h('div', { class: 'so-rresult' }, coinFace(d.result), cap(d.result)),
        h('div', { class: 'so-rwinner' }, h('span', { class: 'faint small' }, 'Winner '), h('span', { class: 'win' }, playerLink(d.winnerId === d.creatorId ? d.creator : d.joiner)), h('span', { class: 'small faint' }, ` +${usd(d.payout)}`)),
        toggle),
      box);
  }
  function addRecent(d, live) {
    if (recentIds.has(d.id)) return;
    recentIds.add(d.id);
    const row = recentRow(d);
    if (live && !reduced()) row.classList.add('so-enter');
    recentList.prepend(row);
    while (recentList.children.length > 20) recentList.lastChild.remove();
    emptyRecent.classList.toggle('hidden', recentList.children.length > 0);
  }

  page.append(h('div', { class: 'so-duels' }, createPanel, openSection), recentSection);
  data.open.forEach((d) => addOpen(d, false));
  data.recent.slice().reverse().forEach((d) => addRecent(d, false));
  emptyRecent.classList.toggle('hidden', recentList.children.length > 0);
  syncOpen();

  // ---------- live ----------
  offs.push(onWs('duel:open', (m) => addOpen(m.duel, true)));
  offs.push(onWs('duel:cancel', (m) => removeOpen(m.id, 'cancel')));
  offs.push(onWs('duel:result', (m) => {
    const d = m.duel;
    removeOpen(d.id);
    addRecent(d, true);
    const id = me()?.id;
    if (id && d.creatorId === id && d.joinerId !== id) { queue.push(d); drainQueue(); }
  }));
  offs.push(ctx.store.on('me', rerenderCards));
  timers.push(setInterval(() => page.querySelectorAll('[data-ts]').forEach((el) => (el.textContent = ago(Number(el.dataset.ts)))), 10000));

  return () => {
    alive = false;
    offs.forEach((f) => f());
    timers.forEach(clearInterval);
    closeOverlay();
    if (ctx.store.get('balanceHold')) release();
  };
}
