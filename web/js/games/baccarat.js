// Baccarat: stack chips on player / banker / tie, deal one punto banco hand.
// The server deals the whole coup in one request; we replay it card by card.
import { h, clear } from '../ui.js';
import { statRow } from '../betpanel.js';
import { usd, mult } from '../format.js';
import { resultStrip, placeBet, useCss } from './common.js';
import { cardEl, pace } from './cards.js';
import { rankOf } from '/shared/fair.js';

const CHIPS = [100_000, 1_000_000, 10_000_000, 100_000_000];
const chipLabel = (u) => String(u / 1_000_000);
const SPOTS = [
  ['player', 'Player', 'Pays 1:1'],
  ['tie', 'Tie', 'Pays 8:1'],
  ['banker', 'Banker', 'Pays 0.95:1'],
];
const point = (c) => Math.min(rankOf(c) + 1, 10) % 10;
const total = (cards) => cards.reduce((a, c) => a + point(c), 0) % 10;

export function mount({ controls, stage, foot, ctx }) {
  useCss('baccarat');
  let chip = CHIPS[1], busy = false, alive = true;
  let bets = { player: 0, banker: 0, tie: 0 };
  const placed = []; // undo stack of [spot, amount]
  const road = [];

  // ---------- controls ----------
  const chipBtns = CHIPS.map((v, i) => h('button', { type: 'button', class: `bac-chip c${i} ${v === chip ? 'on' : ''}`, 'aria-pressed': String(v === chip), 'aria-label': `${usd(v)} chip`,
    onClick: () => { chip = v; chipBtns.forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-pressed', String(j === i)); }); } }, chipLabel(v)));
  const undo = h('button', { class: 'btn grow', type: 'button', onClick: () => { const p = placed.pop(); if (p) { bets[p[0]] -= p[1]; paint(); } } }, 'Undo');
  const dbl = h('button', { class: 'btn grow', type: 'button', onClick: () => { for (const k in bets) if (bets[k]) { placed.push([k, bets[k]]); bets[k] *= 2; } paint(); } }, 'Double');
  const clr = h('button', { class: 'btn grow', type: 'button', onClick: () => { bets = { player: 0, banker: 0, tie: 0 }; placed.length = 0; paint(); } }, 'Clear');
  const deal = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onClick: () => play() }, 'Deal');
  const stats = statRow([['Total bet'], ['Last payout']]);
  controls.append(
    h('div', { class: 'field' }, h('div', { class: 'field-row small muted' }, h('span', 'Chip value'), h('span', { class: 'faint' }, 'Right-click a spot to remove')),
      h('div', { class: 'bac-chips', role: 'group', 'aria-label': 'Chip value' }, chipBtns)),
    h('div', { class: 'row' }, undo, dbl, clr),
    deal, stats.el,
    h('p', { class: 'small faint' }, 'Player pays 1:1 · Banker pays 0.95:1 · Tie pays 8:1 and returns player and banker bets'));

  // ---------- table ----------
  const handEls = {}, totalEls = {}, boxes = {};
  for (const side of ['player', 'banker']) {
    handEls[side] = h('div', { class: 'hand bac-hand' });
    totalEls[side] = h('div', { class: 'bac-total', 'aria-live': 'polite' }, '');
    boxes[side] = h('div', { class: `bac-box ${side}` }, h('div', { class: 'bac-box-head' }, h('span', side === 'player' ? 'Player' : 'Banker'), totalEls[side]), handEls[side]);
  }
  const banner = h('div', { class: 'bac-banner hidden', role: 'status' });
  const spotEls = {};
  const spots = h('div', { class: 'bac-spots' }, SPOTS.map(([id, name, pays]) => {
    const stack = h('div', { class: 'bac-stack' });
    const amt = h('div', { class: 'bac-amt' });
    spotEls[id] = { el: null, stack, amt };
    const el = h('button', { type: 'button', class: `bac-spot ${id}`, 'aria-label': `Bet on ${name.toLowerCase()}`,
      onClick: () => add(id), onContextmenu: (e) => { e.preventDefault(); remove(id); } },
      h('span', { class: 'bac-spot-name' }, name), h('span', { class: 'bac-spot-pays' }, pays), stack, amt);
    spotEls[id].el = el;
    return el;
  }));
  const roadEl = h('div', { class: 'bac-road', 'aria-label': 'Previous winners' });
  stage.append(h('div', { class: 'bac-table' },
    h('div', { class: 'bac-hands' }, boxes.player, h('div', { class: 'bac-vs', 'aria-hidden': 'true' }, 'vs'), boxes.banker),
    banner, spots, h('div', { class: 'bac-road-wrap' }, h('span', { class: 'small faint' }, 'Recent'), roadEl)));
  const push = resultStrip(foot);

  function add(id) {
    if (busy) return;
    bets[id] += chip;
    placed.push([id, chip]);
    paint();
  }
  function remove(id) {
    if (busy) return;
    const i = placed.map((p) => p[0]).lastIndexOf(id);
    if (i < 0) return;
    bets[id] -= placed.splice(i, 1)[0][1];
    paint();
  }

  const sum = () => bets.player + bets.banker + bets.tie;
  function paint() {
    for (const [id] of SPOTS) {
      const v = bets[id];
      const s = spotEls[id];
      s.amt.textContent = v ? usd(v) : '';
      // Break the amount into chip denominations for the stack, biggest first.
      let rest = v; const pile = [];
      for (let i = CHIPS.length - 1; i >= 0 && pile.length < 6; i--) while (rest >= CHIPS[i] && pile.length < 6) { pile.push(i); rest -= CHIPS[i]; }
      clear(s.stack, pile.reverse().map((i, k) => h('span', { class: `bac-chip mini c${i}`, style: { bottom: `${k * 4}px` } })));
      s.el.classList.toggle('has', v > 0);
    }
    stats.set(0, usd(sum()));
    deal.disabled = busy || sum() === 0;
    [undo, dbl, clr].forEach((b) => (b.disabled = busy || sum() === 0));
  }

  function resetTable() {
    for (const side of ['player', 'banker']) {
      clear(handEls[side]);
      totalEls[side].textContent = '';
      boxes[side].classList.remove('won', 'lost');
    }
    for (const [id] of SPOTS) spotEls[id].el.classList.remove('won', 'lost', 'push');
    banner.classList.add('hidden');
  }

  async function play() {
    if (busy || !sum()) return;
    busy = true; paint();
    try {
      const amount = sum();
      const r = await placeBet(ctx, '/api/games/baccarat/bet', { amount, params: { ...bets } });
      if (!r) return;
      resetTable();
      const o = r.outcome;
      const seq = [['player', 0], ['banker', 0], ['player', 1], ['banker', 1]];
      if (o.player[2] !== undefined) seq.push(['player', 2]);
      if (o.banker[2] !== undefined) seq.push(['banker', 2]);
      for (const [side, i] of seq) {
        if (!alive) return;
        await pace(i === 2 ? 520 : 300);
        handEls[side].append(cardEl(o[side][i], { cls: i === 2 ? 'third' : '' }));
        totalEls[side].textContent = String(total(o[side].slice(0, i + 1)));
      }
      await pace(260);
      const w = o.winner;
      if (w !== 'tie') { boxes[w].classList.add('won'); boxes[w === 'player' ? 'banker' : 'player'].classList.add('lost'); }
      for (const [id] of SPOTS) {
        if (!bets[id]) continue;
        const cls = id === w ? 'won' : w === 'tie' && id !== 'tie' ? 'push' : 'lost';
        spotEls[id].el.classList.add(cls);
      }
      const natural = o.player.length === 2 && o.banker.length === 2 && Math.max(o.playerTotal, o.bankerTotal) >= 8;
      const head = w === 'tie' ? `Tie at ${o.playerTotal}` : `${w === 'player' ? 'Player' : 'Banker'} wins ${Math.max(o.playerTotal, o.bankerTotal)} to ${Math.min(o.playerTotal, o.bankerTotal)}`;
      const net = r.payout - r.amount;
      clear(banner, h('strong', head), natural ? h('span', { class: 'bac-natural' }, 'Natural') : null,
        h('span', { class: net > 0 ? 'win' : net < 0 ? 'loss' : 'muted' }, net > 0 ? `+${usd(net)}` : net < 0 ? `−${usd(-net)}` : 'Stake back'));
      banner.className = `bac-banner ${w}`;
      stats.set(1, h('span', { class: r.payout > r.amount ? 'win' : '' }, usd(r.payout)));
      push(r.payout > 0 ? mult(r.multiplier) : '0.00×', r.payout > r.amount);
      road.unshift(w);
      if (road.length > 24) road.pop();
      clear(roadEl, road.map((x) => h('span', { class: `bac-dot ${x}`, title: x }, x === 'player' ? 'P' : x === 'banker' ? 'B' : 'T')));
    } finally {
      busy = false;
      paint();
    }
  }

  paint();
  return () => { alive = false; };
}
