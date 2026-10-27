import { pickDistinct, toBp } from '../fair.js';
import { assert, choose } from './util.js';

// 5x5 grid; mine tiles are the first `mines` picks of a 25-tile draw.
// After k safe reveals the multiplier is (1 - edge) * C(25, k) / C(25 - mines, k).
export const minesMultiplier = (mines, k) => (k === 0 ? 1 : (0.99 * choose(25, k)) / choose(25 - mines, k));

export default {
  id: 'mines',
  kind: 'stateful',
  edge: 0.01,
  validate(p) {
    const mines = Number(p.mines);
    assert(Number.isInteger(mines) && mines >= 1 && mines <= 24, 'Mines must be 1-24');
    return { mines };
  },
  start(rng, p) {
    return { mines: p.mines, mineSet: pickDistinct(rng, 25, p.mines), revealed: [], done: false, busted: false, multBp: 0, wagerUnits: 1 };
  },
  nextBp(s, action) {
    if (action === 'reveal') return toBp(minesMultiplier(s.mines, s.revealed.length + 1));
    if (action === 'reveal_many') return toBp(minesMultiplier(s.mines, 25 - s.mines));
    return 0;
  },
  currentBp: (s) => toBp(minesMultiplier(s.mines, s.revealed.length)),
  act(rng, s, action, data = {}) {
    const reveal = (tile) => {
      assert(Number.isInteger(tile) && tile >= 0 && tile < 25, 'Invalid tile');
      assert(!s.revealed.includes(tile), 'Tile already revealed');
      if (s.mineSet.includes(tile)) {
        s.revealed.push(tile);
        s.busted = s.done = true;
        s.multBp = 0;
        return false;
      }
      s.revealed.push(tile);
      return true;
    };
    if (action === 'reveal') {
      if (reveal(Number(data.tile)) && s.revealed.length === 25 - s.mines) this.cashout(s);
    } else if (action === 'reveal_many') {
      const tiles = [...new Set((data.tiles || []).map(Number))];
      assert(tiles.length >= 1 && tiles.length <= 25 - s.mines, 'Invalid tile selection');
      for (const t of tiles) if (!reveal(t)) return { extraUnits: 0 };
      this.cashout(s);
    } else if (action === 'cashout') {
      assert(s.revealed.length > 0, 'Reveal at least one tile first');
      this.cashout(s);
    } else assert(false, 'Unknown action');
    return { extraUnits: 0 };
  },
  cashout(s) {
    s.multBp = toBp(minesMultiplier(s.mines, s.revealed.length));
    s.done = true;
  },
  view(s) {
    return {
      mines: s.mines,
      revealed: s.revealed,
      multiplier: minesMultiplier(s.mines, s.revealed.filter((t) => !s.mineSet.includes(t)).length),
      next: minesMultiplier(s.mines, s.revealed.length + 1),
      done: s.done,
      busted: s.busted,
      ...(s.done ? { mineSet: s.mineSet } : {}),
    };
  },
};
