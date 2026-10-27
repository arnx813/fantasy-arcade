import { h, clear } from '../ui.js';
import { betPanel, statRow, profitText } from '../betpanel.js';
import { resultStrip, placeBet } from './common.js';

export function mount({ controls, stage, foot, ctx }) {
  let target = 50.5, condition = 'over';
  const chance = () => (condition === 'under' ? target : 100 - target);
  const multiplier = () => Math.floor((99 / chance()) * 10000) / 10000;

  const stats = statRow([['Multiplier'], ['Roll ' + condition], ['Win chance']]);
  const slider = h('input', { type: 'range', min: '2', max: '98', step: '0.01', value: String(target), 'aria-label': 'Target', class: 'dice-range' });
  const marker = h('div', { class: 'dice-marker hidden' });
  const flip = h('button', { class: 'btn', onClick: () => { condition = condition === 'over' ? 'under' : 'over'; target = Math.round((100 - target) * 100) / 100; slider.value = target; update(); } }, 'Flip over / under');
  const track = h('div', { class: 'dice-track' }, slider, marker);
  const scale = h('div', { class: 'dice-scale' }, [0, 25, 50, 75, 100].map((n) => h('span', n)));
  const readout = h('div', { class: 'big-readout', style: { marginBottom: '28px' } }, '50.00');

  const panel = betPanel({
    extras: [],
    play: async (amount) => {
      const r = await placeBet(ctx, '/api/games/dice/bet', { amount, params: { target, condition } });
      if (!r) return;
      readout.textContent = r.outcome.roll.toFixed(2);
      readout.style.color = r.outcome.win ? 'var(--win)' : 'var(--loss)';
      marker.classList.remove('hidden');
      marker.style.left = `${r.outcome.roll}%`;
      marker.textContent = r.outcome.roll.toFixed(2);
      marker.classList.toggle('w', r.outcome.win);
      push(r.outcome.roll.toFixed(2), r.outcome.win);
      return r;
    },
  });
  const profit = h('div', { class: 'stat-box' }, h('div', { class: 'k' }, 'Profit on win'), h('div', { class: 'v' }));
  controls.append(panel.el, profit);
  panel.amount.input.addEventListener('input', update);

  stage.append(h('div', { style: { width: '100%', maxWidth: '640px' } }, h('div', { style: { textAlign: 'center' } }, readout), track, scale, h('div', { style: { marginTop: '28px' } }, stats.el), h('div', { style: { marginTop: '12px', textAlign: 'center' } }, flip)));
  const push = resultStrip(foot);

  function update() {
    target = Math.min(98, Math.max(2, Number(slider.value)));
    const pctUnder = condition === 'under' ? target : 0;
    track.style.setProperty('--split', `${target}%`);
    track.classList.toggle('over', condition === 'over');
    stats.set(0, `${multiplier().toFixed(4)}×`);
    stats.set(1, `${target.toFixed(2)}`);
    stats.set(2, `${chance().toFixed(2)}%`);
    clear(profit.querySelector('.v'), profitText(panel.amount.units, multiplier()));
    void pctUnder;
  }
  slider.addEventListener('input', update);
  update();
}
