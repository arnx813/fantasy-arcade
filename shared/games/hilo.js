import { cardAt, rankOf, toBp } from '../fair.js';
import { assert } from './util.js';

// Infinite deck; card i is float i. Ranks A(1) low .. K(13) high.
// Choices: middle cards -> higher_eq / lower_eq; Ace -> higher / same; King -> lower / same.
// Step multiplier = (1 - edge) / P(win), compounded.
export function hiloChoices(card) {
  const r = rankOf(card) + 1;
  if (r === 1) return ['higher', 'same'];
  if (r === 13) return ['lower', 'same'];
  return ['higher_eq', 'lower_eq'];
}
export function hiloProb(card, choice) {
  const r = rankOf(card) + 1;
  return { higher_eq: (14 - r) / 13, lower_eq: r / 13, higher: (13 - r) / 13, lower: (r - 1) / 13, same: 1 / 13 }[choice];
}
function wins(cur, next, choice) {
  const a = rankOf(cur), b = rankOf(next);
  return { higher_eq: b >= a, lower_eq: b <= a, higher: b > a, lower: b < a, same: b === a }[choice];
}

export default {
  id: 'hilo',
  kind: 'stateful',
  edge: 0.01,
  validate: () => ({}),
  start(rng) {
    return { cursor: 1, current: cardAt(rng, 0), history: [], multiplier: 1, wins: 0, done: false, busted: false, multBp: 0, wagerUnits: 1 };
  },
  nextBp(s, action, data = {}) {
    if (action !== 'guess') return 0;
    const p = hiloProb(s.current, data.choice);
    return p ? toBp((s.multiplier * 0.99) / p) : 0;
  },
  act(rng, s, action, data = {}) {
    if (action === 'guess') {
      const choice = data.choice;
      assert(hiloChoices(s.current).includes(choice), 'Invalid guess for this card');
      const next = cardAt(rng, s.cursor++);
      const won = wins(s.current, next, choice);
      s.history.push({ from: s.current, card: next, choice, won });
      s.current = next;
      if (won) {
        s.multiplier = (s.multiplier * 0.99) / hiloProb(s.history.at(-1).from, choice);
        s.wins++;
      } else {
        s.busted = s.done = true;
        s.multBp = 0;
      }
    } else if (action === 'skip') {
      assert(s.history.length < 200, 'Skip limit reached');
      const next = cardAt(rng, s.cursor++);
      s.history.push({ from: s.current, card: next, choice: 'skip', won: null });
      s.current = next;
    } else if (action === 'cashout') {
      assert(s.wins > 0, 'Make at least one correct guess first');
      s.multBp = toBp(s.multiplier);
      s.done = true;
    } else assert(false, 'Unknown action');
    return { extraUnits: 0 };
  },
  view(s) {
    return {
      current: s.current,
      history: s.history,
      multiplier: s.multiplier,
      choices: hiloChoices(s.current).map((c) => ({ choice: c, chance: hiloProb(s.current, c), multiplier: (s.multiplier * 0.99) / hiloProb(s.current, c) })),
      canCashout: s.wins > 0,
      done: s.done,
      busted: s.busted,
    };
  },
};
