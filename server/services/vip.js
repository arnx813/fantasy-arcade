import { USD } from '../config.js';

// Tiers by lifetime wager. rakeback = share of theoretical house edge returned.
export const VIP_LEVELS = [
  { name: 'Insert Coin', min: 0, rakeback: 0.05 },
  { name: 'Rookie', min: 1_000, rakeback: 0.05 },
  { name: 'Challenger', min: 10_000, rakeback: 0.06 },
  { name: 'High Score', min: 50_000, rakeback: 0.07 },
  { name: 'Combo', min: 100_000, rakeback: 0.08 },
  { name: 'Boss Fight', min: 500_000, rakeback: 0.1 },
  { name: 'Legend', min: 1_000_000, rakeback: 0.12 },
  { name: 'Mythic', min: 5_000_000, rakeback: 0.15 },
].map((l, i) => ({ ...l, level: i, min: l.min * USD }));

export function vipFor(wagered) {
  let i = 0;
  while (i + 1 < VIP_LEVELS.length && wagered >= VIP_LEVELS[i + 1].min) i++;
  const cur = VIP_LEVELS[i], next = VIP_LEVELS[i + 1];
  return {
    ...cur,
    next: next ? { name: next.name, min: next.min } : null,
    progress: next ? (wagered - cur.min) / (next.min - cur.min) : 1,
  };
}
