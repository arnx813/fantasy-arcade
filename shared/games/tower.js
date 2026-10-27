import { pickDistinct, toBp } from '../fair.js';
import { assert } from './util.js';

// Climb 9 floors. Each floor has `cols` doors, `safe` of them safe. Floor L's safe
// doors are drawn from floats starting at L * 4.
export const TOWER_LEVELS = 9;
export const TOWER_MODES = {
  easy: { cols: 4, safe: 3 },
  medium: { cols: 3, safe: 2 },
  hard: { cols: 2, safe: 1 },
  expert: { cols: 3, safe: 1 },
  master: { cols: 4, safe: 1 },
};
export const towerMultiplier = (mode, level) => {
  const { cols, safe } = TOWER_MODES[mode];
  return level === 0 ? 1 : 0.99 / (safe / cols) ** level;
};

export default {
  id: 'tower',
  kind: 'stateful',
  edge: 0.01,
  validate(p) {
    assert(TOWER_MODES[p.difficulty], 'Invalid difficulty');
    return { difficulty: p.difficulty };
  },
  start(rng, p) {
    const { cols, safe } = TOWER_MODES[p.difficulty];
    const layout = [...Array(TOWER_LEVELS)].map((_, L) => pickDistinct(rng, cols, safe, L * 4).sort());
    return { difficulty: p.difficulty, layout, picks: [], level: 0, done: false, busted: false, multBp: 0, wagerUnits: 1 };
  },
  nextBp: (s, action) => (action === 'pick' ? toBp(towerMultiplier(s.difficulty, s.level + 1)) : 0),
  act(rng, s, action, data = {}) {
    const { cols } = TOWER_MODES[s.difficulty];
    if (action === 'pick') {
      const col = Number(data.col);
      assert(Number.isInteger(col) && col >= 0 && col < cols, 'Invalid door');
      s.picks.push(col);
      if (!s.layout[s.level].includes(col)) {
        s.busted = s.done = true;
        s.multBp = 0;
      } else if (++s.level === TOWER_LEVELS) {
        s.multBp = toBp(towerMultiplier(s.difficulty, s.level));
        s.done = true;
      }
    } else if (action === 'cashout') {
      assert(s.level > 0, 'Climb at least one floor first');
      s.multBp = toBp(towerMultiplier(s.difficulty, s.level));
      s.done = true;
    } else assert(false, 'Unknown action');
    return { extraUnits: 0 };
  },
  view(s) {
    return {
      difficulty: s.difficulty,
      level: s.level,
      picks: s.picks,
      multiplier: towerMultiplier(s.difficulty, s.level),
      next: s.level < TOWER_LEVELS ? towerMultiplier(s.difficulty, s.level + 1) : null,
      done: s.done,
      busted: s.busted,
      ...(s.done ? { layout: s.layout } : {}),
    };
  },
};
