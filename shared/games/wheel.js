import { toBp } from '../fair.js';
import { WHEEL } from '../tables.js';
import { assert } from './util.js';

export default {
  id: 'wheel',
  kind: 'instant',
  edge: 0.01,
  validate(p) {
    const segments = Number(p.segments);
    assert([10, 20, 30, 40, 50].includes(segments), 'Segments must be 10-50');
    assert(['low', 'medium', 'high'].includes(p.risk), 'Invalid risk');
    return { segments, risk: p.risk };
  },
  maxMultiplier: (p) => Math.max(...WHEEL[p.risk][p.segments]),
  play(rng, p) {
    const segment = Math.floor(rng.float(0) * p.segments);
    const multiplier = WHEEL[p.risk][p.segments][segment];
    return { multBp: toBp(multiplier), outcome: { segment, multiplier } };
  },
};
