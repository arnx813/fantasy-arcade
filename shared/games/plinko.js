import { toBp } from '../fair.js';
import { PLINKO } from '../tables.js';
import { assert } from './util.js';

// One float per row: < 0.5 bounces left, otherwise right. Bin = number of rights.
export default {
  id: 'plinko',
  kind: 'instant',
  edge: 0.01,
  validate(p) {
    const rows = Number(p.rows);
    const risk = p.risk;
    assert(Number.isInteger(rows) && rows >= 8 && rows <= 16, 'Rows must be 8-16');
    assert(['low', 'medium', 'high'].includes(risk), 'Invalid risk');
    return { rows, risk };
  },
  maxMultiplier: (p) => Math.max(...PLINKO[p.risk][p.rows]),
  play(rng, p) {
    const path = [];
    for (let i = 0; i < p.rows; i++) path.push(rng.float(i) < 0.5 ? 0 : 1);
    const bin = path.reduce((a, b) => a + b, 0);
    const multiplier = PLINKO[p.risk][p.rows][bin];
    return { multBp: toBp(multiplier), outcome: { path, bin, multiplier } };
  },
};
