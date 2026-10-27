import { floor2, toBp } from '../fair.js';
import { assert } from './util.js';

// result = floor2((1 - edge) / (1 - f)), so P(result >= t) = 0.99 / t.
export const LIMBO_MAX = 1_000_000;
export default {
  id: 'limbo',
  kind: 'instant',
  edge: 0.01,
  validate(p) {
    const target = Math.floor(Number(p.target) * 100 + 1e-9) / 100;
    assert(Number.isFinite(target) && target >= 1.01 && target <= LIMBO_MAX, 'Target must be between 1.01x and 1,000,000x');
    return { target };
  },
  maxMultiplier: (p) => p.target,
  play(rng, p) {
    const raw = floor2(0.99 / (1 - rng.float(0)));
    const result = Math.min(Math.max(raw, 1), LIMBO_MAX);
    const win = result >= p.target;
    return { multBp: win ? toBp(p.target) : 0, outcome: { result, win } };
  },
};
