// Money is micro-USD integers end to end; the UI shows dollars.
export const UNIT = 1_000_000;
export const toUnits = (usd) => Math.round(Number(usd || 0) * UNIT);
export const fromUnits = (u) => u / UNIT;
export function usd(u, { sign = false, compact = false } = {}) {
  const v = u / UNIT;
  const abs = Math.abs(v);
  let s;
  if (compact && abs >= 1e6) s = (abs / 1e6).toFixed(2) + 'M';
  else if (compact && abs >= 1e4) s = (abs / 1e3).toFixed(1) + 'K';
  else s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: abs < 1 && abs > 0 ? 4 : 2 });
  return (v < 0 ? '−' : sign && v > 0 ? '+' : '') + '$' + s;
}
export const mult = (m, dp = 2) => `${Number(m).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}×`;
export const pct = (p, dp = 2) => `${(p * 100).toFixed(dp)}%`;
export function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}
export const GAME_NAMES = {
  crash: 'Crash', dice: 'Dice', limbo: 'Limbo', coinflip: 'Coinflip', plinko: 'Plinko', keno: 'Keno', wheel: 'Wheel',
  roulette: 'Roulette', baccarat: 'Baccarat', videopoker: 'Video Poker', mines: 'Mines', tower: 'Tower', hilo: 'HiLo', blackjack: 'Blackjack',
  jackpot: 'Jackpot', duel: 'Coinflip duel',
};
