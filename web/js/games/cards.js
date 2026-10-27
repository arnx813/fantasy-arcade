// Playing-card rendering shared by Blackjack, Baccarat, Video Poker and HiLo.
// Builds on the `.card` styles in app.css; the extra rules (sizing, pips, flip) are
// injected once here so each game stylesheet only handles its own table.
import { h } from '../ui.js';
import { RANKS, SUITS, rankOf, suitOf } from '/shared/fair.js';

const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANK_NAMES = ['Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King'];

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Animation pause that collapses to nothing for reduced motion.
export const pace = (ms) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));

export const isRed = (c) => suitOf(c) === 1 || suitOf(c) === 2;
export const cardName = (c) => `${RANK_NAMES[rankOf(c)]} of ${SUIT_NAMES[suitOf(c)]}`;

const CSS = `
.fa-card { --cw: 74px; width: var(--cw); height: calc(var(--cw) * 1.405); border-radius: calc(var(--cw) * 0.11);
  font-size: calc(var(--cw) * 0.36); overflow: hidden; }
.fa-card .corner { top: calc(var(--cw) * 0.07); left: calc(var(--cw) * 0.09); font-size: calc(var(--cw) * 0.19); line-height: 0.95; display: grid; justify-items: center; }
.fa-card .corner.br { top: auto; left: auto; bottom: calc(var(--cw) * 0.07); right: calc(var(--cw) * 0.09); transform: rotate(180deg); }
.fa-card .pip { display: grid; place-items: center; line-height: 1; }
.fa-card .pip small { font: 700 calc(var(--cw) * 0.22)/1 var(--ui); margin-top: 2px; }
.fa-card.face .pip { width: 54%; height: 52%; border-radius: calc(var(--cw) * 0.08); border: 2px solid currentColor;
  background: repeating-linear-gradient(135deg, transparent 0 5px, rgba(36, 26, 56, 0.06) 5px 7px); }
.fa-card.back { background:
  radial-gradient(circle at 50% 50%, #fff3 0 18%, transparent 19%),
  repeating-linear-gradient(45deg, var(--marquee) 0 6px, #e29a0e 6px 12px); box-shadow: 0 4px 0 rgba(0,0,0,0.25), inset 0 0 0 4px #fbf8ff; }
.fa-card.still { animation: none; }
.fa-card.flip { animation: fa-flip 0.28s ease-out; }
@keyframes fa-flip { 0% { transform: rotateY(90deg); } 100% { transform: rotateY(0); } }
`;
let injected = false;
function inject() {
  if (injected || document.getElementById('fa-cards-css')) return;
  injected = true;
  document.head.append(h('style', { id: 'fa-cards-css' }, CSS));
}

// c: card index 0..51, or null/undefined for a face-down card.
export function cardEl(c, { cls = '', flip = false } = {}) {
  inject();
  if (c === null || c === undefined) return h('div', { class: `card fa-card back ${cls}`, role: 'img', 'aria-label': 'Face-down card' });
  const r = RANKS[rankOf(c)], s = SUITS[suitOf(c)];
  const face = rankOf(c) >= 10;
  return h('div', { class: `card fa-card ${isRed(c) ? 'red' : ''} ${face ? 'face' : ''} ${flip ? 'flip' : ''} ${cls}`, role: 'img', 'aria-label': cardName(c), 'data-card': c },
    h('span', { class: 'corner', 'aria-hidden': 'true' }, h('span', r), h('span', s)),
    h('span', { class: 'pip', 'aria-hidden': 'true' }, face ? [r, h('small', s)] : s),
    h('span', { class: 'corner br', 'aria-hidden': 'true' }, h('span', r), h('span', s)));
}

// Swap a card element for a new one (e.g. reveal a hole card) with a flip.
export function flipCard(el, c, opts = {}) {
  const next = cardEl(c, { ...opts, flip: true });
  el.replaceWith(next);
  return next;
}
