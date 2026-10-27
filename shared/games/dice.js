import { BP, toBp } from '../fair.js';
import { assert } from './util.js';

// Roll is uniform on 0.00..100.00 (10,001 outcomes). Win chance is the target (under)
// or 100 - target (over); multiplier = (1 - edge) * 100 / chance.
export default {
  id: 'dice',
  kind: 'instant',
  edge: 0.01,
  validate(p) {
    const target = Math.round(Number(p.target) * 100) / 100;
    const condition = p.condition === 'under' ? 'under' : 'over';
    const chance = condition === 'under' ? target : 100 - target;
    assert(Number.isFinite(target), 'Invalid target');
    assert(chance >= 0.01 && chance <= 98, 'Win chance must be between 0.01% and 98%');
    return { target, condition };
  },
  multiplierBp(p) {
    const chance = p.condition === 'under' ? p.target : 100 - p.target;
    return toBp((99 / chance) );
  },
  maxMultiplier(p) {
    return this.multiplierBp(p) / BP;
  },
  play(rng, p) {
    const roll = Math.floor(rng.float(0) * 10001) / 100;
    const win = p.condition === 'under' ? roll < p.target : roll > p.target;
    return { multBp: win ? this.multiplierBp(p) : 0, outcome: { roll, win } };
  },
};
