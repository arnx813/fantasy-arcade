import { pickDistinct, rankOf, suitOf, BP } from '../fair.js';
import { assert } from './util.js';

// Jacks or Better, single 52-card deck shuffled per hand. Floats 0..9 pick the 5 dealt
// cards and the 5 replacement cards (in order) without replacement.
export const PAYTABLE = [
  ['royal_flush', 'Royal Flush', 800],
  ['straight_flush', 'Straight Flush', 50],
  ['four_kind', 'Four of a Kind', 25],
  ['full_house', 'Full House', 9],
  ['flush', 'Flush', 6],
  ['straight', 'Straight', 4],
  ['three_kind', 'Three of a Kind', 3],
  ['two_pair', 'Two Pair', 2],
  ['jacks_better', 'Jacks or Better', 1],
];

export function evaluate(cards) {
  const ranks = cards.map((c) => (rankOf(c) === 0 ? 14 : rankOf(c) + 1)).sort((a, b) => a - b);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const uniq = [...new Set(ranks)];
  const wheel = uniq.join() === '2,3,4,5,14';
  const straight = uniq.length === 5 && (ranks[4] - ranks[0] === 4 || wheel);
  const counts = Object.values(ranks.reduce((m, r) => ((m[r] = (m[r] || 0) + 1), m), {})).sort((a, b) => b - a);
  const pairRanks = uniq.filter((r) => ranks.filter((x) => x === r).length === 2);
  if (straight && flush) return ranks[0] === 10 ? 'royal_flush' : 'straight_flush';
  if (counts[0] === 4) return 'four_kind';
  if (counts[0] === 3 && counts[1] === 2) return 'full_house';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (counts[0] === 3) return 'three_kind';
  if (counts[0] === 2 && counts[1] === 2) return 'two_pair';
  if (counts[0] === 2 && pairRanks[0] >= 11) return 'jacks_better';
  return null;
}
const payFor = (hand) => (hand ? PAYTABLE.find((r) => r[0] === hand)[2] : 0);

export default {
  id: 'videopoker',
  kind: 'stateful',
  edge: 0.0046,
  validate: () => ({}),
  maxMultiplier: () => 800,
  start(rng) {
    const deck = pickDistinct(rng, 52, 10);
    return { deck, hand: deck.slice(0, 5), stage: 'deal', done: false, multBp: 0, wagerUnits: 1 };
  },
  act(rng, s, action, data = {}) {
    assert(action === 'draw', 'Unknown action');
    const holds = (data.holds || []).map(Boolean);
    assert(holds.length === 5, 'Send 5 hold flags');
    let next = 5;
    s.hand = s.hand.map((c, i) => (holds[i] ? c : s.deck[next++]));
    s.result = evaluate(s.hand);
    s.multBp = payFor(s.result) * BP;
    s.stage = 'drawn';
    s.done = true;
    return { extraUnits: 0 };
  },
  view(s) {
    return { hand: s.hand, stage: s.stage, preview: evaluate(s.hand), result: s.result ?? null, done: s.done };
  },
};
