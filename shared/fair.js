// Provably-fair primitives shared by the server and the in-browser verifier.
//
// Every bet is determined by (serverSeed, clientSeed, nonce). Randomness is drawn as
// a stream of floats in [0, 1): block r is HMAC-SHA256(key = serverSeed,
// message = `${clientSeed}:${nonce}:${r}`), and each 4 bytes of a block become one
// float: b0/256 + b1/256^2 + b2/256^3 + b3/256^4. Float i lives in block floor(i/8).
//
// Engines never call HMAC themselves; they receive an `rng` with `float(i)` so the same
// code runs in Node (sync HMAC) and the browser (pre-computed via WebCrypto).

export const FLOATS_PER_BLOCK = 8;

export function bytesToFloats(bytes) {
  const out = [];
  for (let i = 0; i + 4 <= bytes.length; i += 4) {
    out.push(bytes[i] / 256 + bytes[i + 1] / 256 ** 2 + bytes[i + 2] / 256 ** 3 + bytes[i + 3] / 256 ** 4);
  }
  return out;
}

// hmacBlock(r) -> Uint8Array(32). Blocks are cached so engines can index freely.
export function makeRng(hmacBlock) {
  const cache = new Map();
  return {
    float(i) {
      const r = Math.floor(i / FLOATS_PER_BLOCK);
      let block = cache.get(r);
      if (!block) {
        block = bytesToFloats(hmacBlock(r));
        cache.set(r, block);
      }
      return block[i % FLOATS_PER_BLOCK];
    },
  };
}

// Rng over a precomputed float array (browser verifier).
export function arrayRng(floats) {
  return {
    float(i) {
      if (i >= floats.length) throw new Error(`verifier needs more floats (asked for #${i})`);
      return floats[i];
    },
  };
}

// Choose `count` distinct items from 0..n-1 by drawing from a shrinking pool, one float
// per pick starting at float index `offset`. Used by Mines, Keno, Tower, Video Poker.
export function pickDistinct(rng, n, count, offset = 0) {
  const pool = [...Array(n).keys()];
  const out = [];
  for (let i = 0; i < count; i++) {
    const j = Math.floor(rng.float(offset + i) * pool.length);
    out.push(pool.splice(j, 1)[0]);
  }
  return out;
}

// ---- Cards (infinite deck unless a game shuffles a 52-card deck itself) ----
// Card index 0..51: rank = idx % 13 (0 = Ace .. 12 = King), suit = floor(idx / 13).
export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const cardAt = (rng, i) => Math.floor(rng.float(i) * 52);
export const rankOf = (c) => c % 13;
export const suitOf = (c) => Math.floor(c / 13);
export const cardLabel = (c) => RANKS[rankOf(c)] + SUITS[suitOf(c)];

// Multipliers are carried as integer basis points (1x = 10000) to avoid float drift
// in payouts. payout = floor(amount * multBp / 10000).
export const BP = 10000;
export const toBp = (m) => Math.floor(m * BP + 1e-7);
export const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
