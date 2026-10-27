import { pickDistinct, toBp } from '../fair.js';
import { KENO } from '../tables.js';
import { assert } from './util.js';

// 40 tiles, 10 drawn without replacement.
export default {
  id: 'keno',
  kind: 'instant',
  edge: 0.01,
  validate(p) {
    const picks = [...new Set((p.picks || []).map(Number))];
    assert(picks.length >= 1 && picks.length <= 10, 'Pick 1-10 tiles');
    assert(picks.every((n) => Number.isInteger(n) && n >= 1 && n <= 40), 'Tiles are 1-40');
    assert(Object.keys(KENO).includes(p.risk), 'Invalid risk');
    return { picks: picks.sort((a, b) => a - b), risk: p.risk };
  },
  maxMultiplier: (p) => Math.max(...KENO[p.risk][p.picks.length]),
  play(rng, p) {
    const drawn = pickDistinct(rng, 40, 10).map((n) => n + 1);
    const hits = p.picks.filter((n) => drawn.includes(n));
    const multiplier = KENO[p.risk][p.picks.length][hits.length];
    return { multBp: toBp(multiplier), outcome: { drawn, hits, multiplier } };
  },
};
