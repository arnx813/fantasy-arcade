import { cardAt, rankOf, BP } from '../fair.js';
import { assert } from './util.js';

// Infinite deck, dealer stands on all 17s, peeks for blackjack with an Ace or ten-value
// upcard, blackjack pays 3:2, double on any two cards (including after split), one
// split per round, split aces receive one card each. No insurance.
// Card i of the round is float i; cards are dealt in strict order.
const val = (c) => Math.min(rankOf(c) + 1, 10);
export function handValue(cards) {
  let total = cards.reduce((a, c) => a + val(c), 0);
  const soft = cards.some((c) => rankOf(c) === 0) && total + 10 <= 21;
  if (soft) total += 10;
  return { total, soft };
}
const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

export default {
  id: 'blackjack',
  kind: 'stateful',
  edge: 0.005,
  validate: () => ({}),
  maxMultiplier: () => 8, // split + double both hands, both win: 8 base units back
  start(rng) {
    const s = { cursor: 0, dealer: [], hands: [], active: 0, done: false, multBp: 0, wagerUnits: 1, outcome: null };
    const draw = () => cardAt(rng, s.cursor++);
    const p1 = draw(), d1 = draw(), p2 = draw(), d2 = draw();
    s.hands.push({ cards: [p1, p2], bet: 1, done: false, doubled: false, split: false });
    s.dealer = [d1, d2];
    const upTen = val(d1) === 10 || rankOf(d1) === 0;
    if (upTen && isBlackjack(s.dealer)) {
      this.finish(s, isBlackjack(s.hands[0].cards) ? 'push' : 'dealer_blackjack', BP * (isBlackjack(s.hands[0].cards) ? 1 : 0));
    } else if (isBlackjack(s.hands[0].cards)) {
      this.finish(s, 'blackjack', BP * 2.5);
    }
    return s;
  },
  finish(s, outcome, multBp) {
    s.done = true;
    s.outcome = outcome;
    s.multBp = multBp;
    s.hands.forEach((h) => (h.done = true));
  },
  actions(s) {
    if (s.done) return [];
    const h = s.hands[s.active];
    const out = ['hit', 'stand'];
    if (h.cards.length === 2) out.push('double');
    if (s.hands.length === 1 && h.cards.length === 2 && rankOf(h.cards[0]) === rankOf(h.cards[1])) out.push('split');
    return out;
  },
  act(rng, s, action) {
    assert(this.actions(s).includes(action), 'Action not available');
    const draw = () => cardAt(rng, s.cursor++);
    const h = s.hands[s.active];
    let extraUnits = 0;
    if (action === 'hit') {
      h.cards.push(draw());
      if (handValue(h.cards).total >= 21) h.done = true;
    } else if (action === 'stand') {
      h.done = true;
    } else if (action === 'double') {
      extraUnits = 1;
      h.bet = 2;
      h.doubled = true;
      h.cards.push(draw());
      h.done = true;
    } else if (action === 'split') {
      extraUnits = 1;
      const aces = rankOf(h.cards[0]) === 0;
      const second = { cards: [h.cards.pop()], bet: 1, done: false, doubled: false, split: true };
      h.split = true;
      h.cards.push(draw());
      second.cards.push(draw());
      s.hands.push(second);
      if (aces) s.hands.forEach((x) => (x.done = true));
      else s.hands.forEach((x) => { if (handValue(x.cards).total === 21) x.done = true; });
    }
    s.wagerUnits = s.hands.reduce((a, x) => a + x.bet, 0);
    while (s.active < s.hands.length && s.hands[s.active].done) s.active++;
    if (s.active >= s.hands.length) this.settle(s, draw);
    return { extraUnits };
  },
  settle(s, draw) {
    const live = s.hands.some((h) => handValue(h.cards).total <= 21);
    if (live) while (handValue(s.dealer).total < 17) s.dealer.push(draw());
    const d = handValue(s.dealer).total;
    let units = 0;
    for (const h of s.hands) {
      const p = handValue(h.cards).total;
      if (p > 21) h.result = 'bust';
      else if (d > 21 || p > d) { h.result = 'win'; units += 2 * h.bet; }
      else if (p === d) { h.result = 'push'; units += h.bet; }
      else h.result = 'lose';
    }
    s.done = true;
    s.outcome = 'settled';
    s.multBp = units * BP;
  },
  view(s) {
    return {
      hands: s.hands.map((h) => ({ ...h, value: handValue(h.cards) })),
      active: s.active,
      dealer: s.done ? s.dealer : [s.dealer[0]],
      dealerValue: handValue(s.done ? s.dealer : [s.dealer[0]]),
      actions: this.actions(s),
      done: s.done,
      outcome: s.outcome,
    };
  },
};
