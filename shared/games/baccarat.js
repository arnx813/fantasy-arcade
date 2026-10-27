import { cardAt, rankOf } from '../fair.js';
import { assert } from './util.js';

// Punto banco, infinite deck, standard tableau. Banker pays 0.95:1, tie 8:1 and
// pushes player/banker bets.
const point = (c) => Math.min(rankOf(c) + 1, 10) % 10;
const total = (cards) => cards.reduce((a, c) => a + point(c), 0) % 10;

function bankerDraws(b, p3) {
  if (p3 === undefined) return b <= 5;
  const v = point(p3);
  if (b <= 2) return true;
  if (b === 3) return v !== 8;
  if (b === 4) return v >= 2 && v <= 7;
  if (b === 5) return v >= 4 && v <= 7;
  if (b === 6) return v === 6 || v === 7;
  return false;
}

export function dealBaccarat(rng) {
  let i = 0;
  const draw = () => cardAt(rng, i++);
  const player = [draw()], banker = [draw()];
  player.push(draw()); banker.push(draw());
  const natural = total(player) >= 8 || total(banker) >= 8;
  if (!natural) {
    let p3;
    if (total(player) <= 5) { p3 = draw(); player.push(p3); }
    if (bankerDraws(total(banker), p3)) banker.push(draw());
  }
  const pt = total(player), bt = total(banker);
  return { player, banker, playerTotal: pt, bankerTotal: bt, winner: pt > bt ? 'player' : bt > pt ? 'banker' : 'tie' };
}

export default {
  id: 'baccarat',
  kind: 'instant',
  edge: 0.0106,
  validate(p) {
    const out = {};
    for (const k of ['player', 'banker', 'tie']) {
      out[k] = Number(p[k] || 0);
      assert(Number.isInteger(out[k]) && out[k] >= 0, `Invalid ${k} bet`);
    }
    return out;
  },
  wager: (p) => p.player + p.banker + p.tie,
  maxPayout: (p) => Math.max(p.player * 2, Math.floor(p.banker * 1.95), p.tie * 9 + p.player + p.banker),
  play(rng, p) {
    const hand = dealBaccarat(rng);
    let payout = 0;
    if (hand.winner === 'player') payout = p.player * 2;
    else if (hand.winner === 'banker') payout = Math.floor(p.banker * 1.95);
    else payout = p.tie * 9 + p.player + p.banker;
    return { payout, outcome: hand };
  },
};
