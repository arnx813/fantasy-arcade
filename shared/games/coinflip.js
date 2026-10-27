import { toBp } from '../fair.js';

export default {
  id: 'coinflip',
  kind: 'instant',
  edge: 0.01,
  validate: (p) => ({ side: p.side === 'tails' ? 'tails' : 'heads' }),
  maxMultiplier: () => 1.98,
  play(rng, p) {
    const side = rng.float(0) < 0.5 ? 'heads' : 'tails';
    const win = side === p.side;
    return { multBp: win ? toBp(1.98) : 0, outcome: { side, win } };
  },
};
