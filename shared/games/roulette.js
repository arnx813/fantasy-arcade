import { assert } from './util.js';

// Single-zero roulette. Bets carry their own amounts (integer units); the wager is
// their sum. Payout multipliers include the stake (straight = 36x total return).
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const row = (n) => Math.ceil(n / 3); // 1..12
const col = (n) => ((n - 1) % 3) + 1; // 1..3

const TYPES = {
  straight: { mult: 36, n: 1 },
  split: { mult: 18, n: 2 },
  street: { mult: 12, n: 3 },
  corner: { mult: 9, n: 4 },
  line: { mult: 6, n: 6 },
  dozen: { mult: 3 },
  column: { mult: 3 },
  red: { mult: 2 }, black: { mult: 2 }, odd: { mult: 2 }, even: { mult: 2 }, low: { mult: 2 }, high: { mult: 2 },
};

function validNumbers(type, nums) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.every((n) => Number.isInteger(n) && n >= 0 && n <= 36) || new Set(s).size !== s.length) return false;
  if (type === 'straight') return true;
  if (s.includes(0)) {
    // Zero may split/street with the first row (0-1, 0-2, 0-3, 0-1-2, 0-2-3) or corner 0-1-2-3.
    if (type === 'split') return s[1] <= 3;
    if (type === 'street') return (s[1] === 1 && s[2] === 2) || (s[1] === 2 && s[2] === 3);
    if (type === 'corner') return s.join() === '0,1,2,3';
    return false;
  }
  if (type === 'split') return (s[1] - s[0] === 3) || (s[1] - s[0] === 1 && row(s[0]) === row(s[1]));
  if (type === 'street') return row(s[0]) === row(s[2]) && col(s[0]) === 1;
  if (type === 'corner') return s[1] - s[0] === 1 && row(s[0]) === row(s[1]) && s[2] === s[0] + 3 && s[3] === s[1] + 3;
  if (type === 'line') return col(s[0]) === 1 && s[5] === s[0] + 5;
  return false;
}

function wins(bet, n) {
  if (TYPES[bet.type].n) return bet.numbers.includes(n);
  if (n === 0) return false;
  switch (bet.type) {
    case 'dozen': return Math.ceil(n / 12) === bet.value;
    case 'column': return col(n) === bet.value;
    case 'red': return RED.has(n);
    case 'black': return !RED.has(n);
    case 'odd': return n % 2 === 1;
    case 'even': return n % 2 === 0;
    case 'low': return n <= 18;
    case 'high': return n >= 19;
  }
  return false;
}

export default {
  id: 'roulette',
  kind: 'instant',
  edge: 1 / 37,
  validate(p) {
    const bets = (p.bets || []).map((b) => ({ ...b, amount: Number(b.amount) }));
    assert(bets.length >= 1 && bets.length <= 60, 'Place 1-60 chips');
    for (const b of bets) {
      assert(TYPES[b.type], `Unknown bet type ${b.type}`);
      assert(Number.isInteger(b.amount) && b.amount >= 0, 'Invalid chip amount');
      if (TYPES[b.type].n) {
        b.numbers = (b.numbers || []).map(Number);
        assert(b.numbers.length === TYPES[b.type].n && validNumbers(b.type, b.numbers), `Invalid ${b.type} numbers`);
      } else if (b.type === 'dozen' || b.type === 'column') {
        b.value = Number(b.value);
        assert([1, 2, 3].includes(b.value), `Invalid ${b.type}`);
      }
    }
    return { bets: bets.map(({ type, numbers, value, amount }) => ({ type, numbers, value, amount })) };
  },
  wager: (p) => p.bets.reduce((a, b) => a + b.amount, 0),
  // Worst-case payout for the max-profit check, evaluated over every pocket.
  maxPayout(p) {
    let worst = 0;
    for (let n = 0; n <= 36; n++) {
      const pay = p.bets.reduce((a, b) => a + (wins(b, n) ? b.amount * TYPES[b.type].mult : 0), 0);
      worst = Math.max(worst, pay);
    }
    return worst;
  },
  play(rng, p) {
    const number = Math.floor(rng.float(0) * 37);
    const payout = p.bets.reduce((a, b) => a + (wins(b, number) ? b.amount * TYPES[b.type].mult : 0), 0);
    const color = number === 0 ? 'green' : RED.has(number) ? 'red' : 'black';
    return { payout, outcome: { number, color } };
  },
};
