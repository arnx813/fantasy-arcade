// Crash point from a round hash. Rounds consume a reverse SHA-256 hash chain: the
// published terminal hash commits to every future round. The crash point is
// HMAC-SHA256(key = roundHash, message = salt), first 52 bits as r in [0, 1), and
// crash = floor2((1 - edge) / (1 - r)), minimum 1.00. So P(crash >= x) = 0.99 / x.
export const CRASH_EDGE = 0.01;
export function crashFromHmacHex(hex, edge = CRASH_EDGE) {
  const r = parseInt(hex.slice(0, 13), 16) / 2 ** 52;
  const x = Math.floor(((1 - edge) / (1 - r)) * 100 + 1e-9) / 100;
  return Math.max(1, x);
}
// Multiplier as a function of elapsed ms. Shared so the client animation matches.
export const CRASH_GROWTH = 0.00006;
export const crashMultiplierAt = (ms) => Math.floor(Math.exp(CRASH_GROWTH * ms) * 100) / 100;
export const crashTimeFor = (m) => Math.log(m) / CRASH_GROWTH;
