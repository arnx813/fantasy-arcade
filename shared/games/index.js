import dice from './dice.js';
import limbo from './limbo.js';
import coinflip from './coinflip.js';
import plinko from './plinko.js';
import keno from './keno.js';
import wheel from './wheel.js';
import roulette from './roulette.js';
import baccarat from './baccarat.js';
import videopoker from './videopoker.js';
import mines from './mines.js';
import tower from './tower.js';
import hilo from './hilo.js';
import blackjack from './blackjack.js';

// Crash is not here: it is a shared multiplayer round driven by the server loop
// (server/services/crash.js) and seeded by a hash chain, not by per-user seeds.
export const ENGINES = { dice, limbo, coinflip, plinko, keno, wheel, roulette, baccarat, videopoker, mines, tower, hilo, blackjack };

export const CATALOG = [
  { id: 'crash', name: 'Crash', tagline: 'Cash out before the rocket pops', rtp: 99 },
  { id: 'mines', name: 'Mines', tagline: 'Dodge the bombs, stack the multiplier', rtp: 99 },
  { id: 'plinko', name: 'Plinko', tagline: 'Drop a ball through the pegs', rtp: 99 },
  { id: 'dice', name: 'Dice', tagline: 'Roll over or under your target', rtp: 99 },
  { id: 'limbo', name: 'Limbo', tagline: 'Pick a target, beat the roll', rtp: 99 },
  { id: 'blackjack', name: 'Blackjack', tagline: '3:2 blackjack, dealer stands 17', rtp: 99.5 },
  { id: 'hilo', name: 'HiLo', tagline: 'Higher or lower, card by card', rtp: 99 },
  { id: 'keno', name: 'Keno', tagline: 'Pick up to 10 of 40 numbers', rtp: 99 },
  { id: 'tower', name: 'Tower', tagline: 'Climb nine floors of doors', rtp: 99 },
  { id: 'wheel', name: 'Wheel', tagline: 'Spin for up to 49.5x', rtp: 99 },
  { id: 'roulette', name: 'Roulette', tagline: 'Single-zero table', rtp: 97.3 },
  { id: 'baccarat', name: 'Baccarat', tagline: 'Player, banker or tie', rtp: 98.9 },
  { id: 'videopoker', name: 'Video Poker', tagline: 'Jacks or Better, 9/6', rtp: 99.5 },
  { id: 'coinflip', name: 'Coinflip', tagline: 'Heads or tails at 1.98x', rtp: 99 },
];
