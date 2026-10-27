// Coinflip: call heads or tails, 1.98x on a match.
import { h } from '../ui.js';
import { betPanel, statRow, profitText } from '../betpanel.js';
import { usd } from '../format.js';
import { resultStrip, placeBet, useCss, sleep } from './common.js';

const MULT = 1.98;
// Original faces: heads is a sun with rays, tails is a crescent moon over a little star.
const HEADS = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" fill="#ffd23f"/><circle cx="50" cy="50" r="40" fill="none" stroke="#b07a00" stroke-width="3" stroke-dasharray="3 5"/>
  ${[...Array(12)].map((_, i) => `<path d="M50 20 l3 8 h-6z" fill="#b07a00" transform="rotate(${i * 30} 50 50)"/>`).join('')}
  <circle cx="50" cy="50" r="15" fill="#b07a00"/><circle cx="45" cy="45" r="5" fill="#ffe27a"/></svg>`;
const TAILS = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" fill="#c9b8ff"/><circle cx="50" cy="50" r="40" fill="none" stroke="#5a43a8" stroke-width="3" stroke-dasharray="3 5"/>
  <circle cx="46" cy="50" r="24" fill="#5a43a8"/><circle cx="57" cy="44" r="20" fill="#c9b8ff"/><path d="M68 58l2.4 5 5.6.6-4.2 3.8 1.2 5.5-5-2.9-5 2.9 1.2-5.5-4.2-3.8 5.6-.6z" fill="#5a43a8"/></svg>`;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mount({ controls, stage, foot, ctx }) {
  useCss('coinflip');
  let side = 'heads', turns = 0, flipping = false;

  const sideSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Pick a side' },
    ['heads', 'tails'].map((s) => h('button', { type: 'button', role: 'radio', 'data-side': s, onClick: () => choose(s) }, s === 'heads' ? 'Heads' : 'Tails')));
  const stats = statRow([['Multiplier'], ['Win chance']]);
  stats.set(0, `${MULT.toFixed(2)}×`);
  stats.set(1, '50.00%');
  const profit = h('div', { class: 'stat-box' }, h('div', { class: 'k' }, 'Profit on win'), h('div', { class: 'v' }));

  const panel = betPanel({
    extras: [h('div', { class: 'coin-pick' }, h('span', 'Your call'), sideSeg)],
    play,
  });
  controls.append(panel.el, stats.el, profit);
  panel.amount.input.addEventListener('input', update);

  const coin = h('div', { class: 'coin' },
    h('div', { class: 'coin-face heads', html: HEADS }),
    h('div', { class: 'coin-face tails', html: TAILS }));
  const shadow = h('div', { class: 'coin-shadow' });
  const label = h('div', { class: 'coin-label', role: 'status', 'aria-live': 'polite' }, 'Pick a side and flip');
  stage.append(h('div', { class: 'coin-wrap' }, h('div', { class: 'coin-stage' }, coin, shadow), label));
  const push = resultStrip(foot);

  function choose(s) {
    if (flipping) return;
    side = s;
    sideSeg.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.side === s;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  function update() {
    profit.querySelector('.v').textContent = profitText(panel.amount.units, MULT);
  }

  async function play(amount) {
    if (flipping) return undefined;
    const r = await placeBet(ctx, '/api/games/coinflip/bet', { amount, params: { side } });
    if (!r) return undefined;
    flipping = true;
    sideSeg.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const land = r.outcome.side;
    // Always spin forward: whole turns plus a half if landing on tails.
    const base = Math.ceil(turns / 360) * 360;
    turns = base + 360 * 4 + (land === 'tails' ? 180 : 0);
    label.className = 'coin-label';
    label.textContent = 'Flipping…';
    coin.classList.remove('landed');
    if (reduced()) {
      coin.style.transition = 'none';
      coin.style.transform = `rotateY(${turns}deg)`;
    } else {
      coin.style.transition = '';
      coin.classList.add('flipping');
      coin.style.transform = `rotateY(${turns}deg)`;
      await sleep(900);
      coin.classList.remove('flipping');
    }
    coin.classList.add('landed');
    label.className = `coin-label ${r.outcome.win ? 'win' : 'loss'}`;
    label.textContent = `${land === 'heads' ? 'Heads' : 'Tails'} · ${r.outcome.win ? `won ${usd(r.payout)}` : 'no luck this time'}`;
    push(land === 'heads' ? 'H' : 'T', r.outcome.win);
    sideSeg.querySelectorAll('button').forEach((b) => (b.disabled = false));
    flipping = false;
    return r;
  }

  choose(side);
  update();
}
