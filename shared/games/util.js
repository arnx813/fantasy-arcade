// Small helpers shared by the game engines.
export class GameError extends Error {
  constructor(message) {
    super(message);
    this.userFacing = true;
  }
}
export const assert = (cond, msg) => {
  if (!cond) throw new GameError(msg);
};
export const isInt = (x) => Number.isInteger(x);
export function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
