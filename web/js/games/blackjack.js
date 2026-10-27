// Blackjack: deal, then hit / stand / double / split until the dealer settles.
// The server holds the shoe; the dealer's hole card only arrives once the round ends.
import { h, clear } from '../ui.js';
import { amountField, statRow } from '../betpanel.js';
import { usd, mult } from '../format.js';
import { resultStrip, placeBet, useCss } from './common.js';
import { cardEl, pace } from './cards.js';
import { handValue } from '/shared/games/blackjack.js';

const ACTIONS = [
  ['hit', 'Hit', 'H'],
  ['stand', 'Stand', 'S'],
  ['double', 'Double', 'D'],
  ['split', 'Split', 'P'],
];

export async function mount({ controls, stage, foot, ctx }) {
  useCss('blackjack');
  let game = null, busy = false, alive = true;
  // What is on the table right now (may lag the server state while cards are dealt).
  let shown = { hands: [], dealer: [], hole: false };

  const amount = amountField(Number(localStorage.getItem('fa:lastBet') || 1));
  const deal = h('button', { class: 'btn btn-primary btn-lg btn-block' }, 'Deal');
  const btns = Object.fromEntries(ACTIONS.map(([id, label, key]) => [id, h('button', { class: `btn bj-act bj-${id}`, 'aria-keyshortcuts': key, onClick: () => act(id) },
    h('span', label), h('span', { class: 'bj-extra' }))]));
  const actGrid = h('div', { class: 'bj-actions' }, Object.values(btns));
  const stats = statRow([['In play'], ['Hands'], ['Last result']]);
  controls.append(amount.el, deal, actGrid, stats.el,
    h('p', { class: 'small faint bj-rules' }, 'Blackjack pays 3:2 · Dealer stands on 17 · No insurance'),
    h('p', { class: 'small faint' }, 'Keys: H hit, S stand, D double, P split, Space deal'));

  const dealerZone = h('div', { class: 'bj-zone bj-dealer' });
  const playerZone = h('div', { class: 'bj-zone bj-player' });
  const table = h('div', { class: 'bj-table' },
    dealerZone,
    h('div', { class: 'bj-rail', 'aria-hidden': 'true' }, h('span', 'Dealer stands on 17'), h('i'), h('span', 'Blackjack pays 3 to 2')),
    playerZone);
  stage.append(table);
  const push = resultStrip(foot);

  // ---------- rendering ----------
  const totalText = (cards) => {
    if (!cards.length) return '';
    const v = handValue(cards);
    if (cards.length === 2 && v.total === 21) return 'Blackjack';
    if (v.soft && v.total < 21) return `${v.total - 10}/${v.total}`;
    return String(v.total);
  };

  function outcomeOf(hand, i) {
    const s = game?.state;
    if (!s) return null;
    const bet = game.baseAmount * hand.bet;
    const revealed = s.done && !shown.hole && shown.dealer.length >= s.dealer.length;
    if (handValue(hand.cards).total > 21) return ['bust', 'Bust', `−${usd(bet)}`];
    if (!revealed) return null;
    if (s.outcome === 'blackjack') return ['bj', 'Blackjack', `+${usd(Math.floor(game.baseAmount * 1.5))}`];
    if (s.outcome === 'push') return ['push', 'Push', 'Stake back'];
    if (s.outcome === 'dealer_blackjack') return ['lose', 'Dealer blackjack', `−${usd(bet)}`];
    if (!hand.result) return null;
    if (hand.result === 'win') return ['win', 'Win', `+${usd(bet)}`];
    if (hand.result === 'push') return ['push', 'Push', 'Stake back'];
    return ['lose', 'Lose', `−${usd(bet)}`];
  }

  function render(fresh = null) {
    const s = game?.state;
    // dealer
    const dCards = shown.dealer.map((c, i) => cardEl(c, { cls: fresh?.who === 'd' && fresh.i === i ? (fresh.flip ? 'flip' : '') : 'still' }));
    if (shown.hole) dCards.push(cardEl(null, { cls: fresh?.who === 'hole' ? '' : 'still' }));
    const dTotal = totalText(shown.dealer);
    clear(dealerZone,
      h('div', { class: 'bj-label' }, h('span', 'Dealer'), dTotal ? h('span', { class: 'bj-total' }, dTotal) : null),
      h('div', { class: 'hand bj-hand' }, dCards.length ? dCards : h('div', { class: 'bj-slot' })));

    // player hands
    const hands = s ? s.hands : [];
    const els = (shown.hands.length ? shown.hands : [[]]).map((cards, i) => {
      const hand = hands[i];
      const active = s && !s.done && hands.length > 1 && s.active === i;
      const out = hand && shown.hands[i]?.length === hand.cards.length ? outcomeOf(hand, i) : null;
      const cs = cards.map((c, j) => cardEl(c, { cls: fresh?.who === 'p' && fresh.hand === i && fresh.i === j ? '' : 'still' }));
      return h('div', { class: `bj-seat ${active ? 'active' : ''} ${out ? 'out-' + out[0] : ''}`, 'aria-current': active ? 'true' : null },
        h('div', { class: 'hand bj-hand' }, cs.length ? cs : h('div', { class: 'bj-slot' })),
        h('div', { class: 'bj-label' },
          h('span', hands.length > 1 ? `Hand ${i + 1}` : 'You'),
          cards.length ? h('span', { class: 'bj-total' }, totalText(cards)) : null,
          hand?.doubled ? h('span', { class: 'bj-tag' }, 'Doubled') : null),
        out ? h('div', { class: `bj-banner ${out[0]}` }, h('strong', out[1]), h('span', out[2])) : null);
    });
    clear(playerZone, els);
    paintControls();
  }

  function paintControls() {
    const s = game?.state;
    const active = game?.status === 'active';
    const avail = active && !busy ? s.actions : [];
    for (const [id] of ACTIONS) {
      btns[id].disabled = !avail.includes(id);
      const extra = btns[id].querySelector('.bj-extra');
      extra.textContent = (id === 'double' || id === 'split') ? `+${usd(game && active ? game.baseAmount : amount.units)}` : '';
    }
    deal.disabled = busy || active;
    deal.textContent = active ? 'Round in progress' : 'Deal';
    amount.disable(!!active || busy);
    stats.set(0, game ? usd(game.amount) : usd(0));
    stats.set(1, s ? String(s.hands.length) : '—');
  }

  // ---------- dealing sequence ----------
  // Walk from what is shown to the new server state one card at a time.
  async function animateTo(next) {
    const s = next.state;
    const prev = shown;
    const newRound = !game || game.id !== next.id;
    game = next;
    if (newRound) {
      shown = { hands: [[]], dealer: [], hole: false };
      const [p1, p2] = s.hands[0].cards;
      const steps = [['p', p1], ['d', s.dealer[0]], ['p', p2], ['hole']];
      for (const [who, c] of steps) {
        if (!alive) return;
        if (who === 'p') { shown.hands[0].push(c); render({ who: 'p', hand: 0, i: shown.hands[0].length - 1 }); }
        else if (who === 'd') { shown.dealer.push(c); render({ who: 'd', i: 0 }); }
        else { shown.hole = true; render({ who: 'hole' }); }
        await pace(260);
      }
    } else {
      const old = prev.hands.map((x) => x.slice());
      const split = s.hands.length > old.length;
      shown = { hands: s.hands.map((hd, i) => {
        if (i >= old.length) return hd.cards.slice(0, 1); // the card moved over by the split
        let k = 0;
        while (k < old[i].length && k < hd.cards.length && old[i][k] === hd.cards[k] && !(split && k >= 1)) k++;
        return hd.cards.slice(0, k);
      }), dealer: prev.dealer.slice(), hole: prev.hole };
      if (split) { render(); await pace(220); }
      for (let i = 0; i < s.hands.length; i++) {
        while (alive && shown.hands[i].length < s.hands[i].cards.length) {
          shown.hands[i].push(s.hands[i].cards[shown.hands[i].length]);
          render({ who: 'p', hand: i, i: shown.hands[i].length - 1 });
          await pace(260);
        }
      }
    }
    if (s.done) {
      // Reveal the hole card, then the dealer's draws.
      if (shown.hole && s.dealer.length > 1) {
        await pace(160);
        shown.hole = false;
        shown.dealer.push(s.dealer[shown.dealer.length]);
        render({ who: 'd', i: shown.dealer.length - 1, flip: true });
        await pace(420);
      }
      while (alive && shown.dealer.length < s.dealer.length) {
        shown.dealer.push(s.dealer[shown.dealer.length]);
        render({ who: 'd', i: shown.dealer.length - 1 });
        await pace(420);
      }
      shown.hole = false;
    }
    render();
  }

  async function run(path, body) {
    if (busy) return;
    busy = true;
    paintControls();
    try {
      const r = await placeBet(ctx, path, body);
      if (!r) return;
      await animateTo(r);
      if (r.status === 'settled') settle(r);
    } finally {
      busy = false;
      paintControls();
    }
  }

  function settle(r) {
    const win = r.payout > r.amount, push_ = r.payout === r.amount;
    push(r.payout > 0 ? mult(r.payout / r.amount) : '0.00×', win);
    stats.set(2, h('span', { class: win ? 'win' : push_ ? '' : 'loss' }, win ? `+${usd(r.payout - r.amount)}` : push_ ? 'Push' : `−${usd(r.amount - r.payout)}`));
  }

  const start = () => {
    try { localStorage.setItem('fa:lastBet', amount.input.value); } catch {}
    return run('/api/games/blackjack/start', { amount: amount.units, params: {} });
  };
  const act = (action) => game?.status === 'active' && game.state.actions.includes(action) && run('/api/games/blackjack/action', { action });
  deal.addEventListener('click', start);
  amount.input.addEventListener('input', paintControls);

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const hit = ACTIONS.find((a) => a[2].toLowerCase() === k);
    if (hit) { e.preventDefault(); act(hit[0]); }
    else if (k === ' ' && !busy && game?.status !== 'active' && !e.target.closest('button')) { e.preventDefault(); start(); }
  };
  document.addEventListener('keydown', onKey);

  // Resume a hand left open.
  if (ctx.store.get('me')) {
    const r = await ctx.attempt(() => ctx.api.get('/api/games/blackjack/active'));
    if (r?.active) {
      game = { ...r.active, status: 'active' };
      const s = game.state;
      shown = { hands: s.hands.map((x) => x.cards.slice()), dealer: s.dealer.slice(), hole: true };
    }
  }
  render();
  return () => { alive = false; document.removeEventListener('keydown', onKey); };
}
