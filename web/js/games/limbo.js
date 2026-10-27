// Limbo: pick a target multiplier; the round draws one result and you win if it
// reaches the target. The readout climbs from 1.00x to the result, then settles.
import { h, clear } from '../ui.js';
import { betPanel, statRow, profitText } from '../betpanel.js';
import { usd, mult } from '../format.js';
import { resultStrip, placeBet, useCss } from './common.js';

const MIN = 1.01, MAX = 1_000_000;
const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mount({ controls, stage, foot, ctx }) {
  useCss('limbo');
  let target = 2, raf = 0;
  const chance = () => 99 / target;

  // ---- stage ----
  const readout = h('div', { class: 'big-readout limbo-readout' }, '1.00×');
  const caption = h('div', { class: 'limbo-caption' }, 'Set a target and place a bet');
  const fill = h('div', { class: 'limbo-fill' });
  const pin = h('div', { class: 'limbo-pin' }, h('span'));
  const meterEnd = h('span');
  const meter = h('div', { class: 'limbo-meter', 'aria-hidden': 'true' },
    h('div', { class: 'limbo-track' }, fill, pin),
    h('div', { class: 'limbo-scale' }, h('span', '1×'), meterEnd));

  const targetIn = h('input', { class: 'input', type: 'number', min: String(MIN), max: String(MAX), step: '0.01', value: '2.00', inputMode: 'decimal', 'aria-label': 'Target multiplier' });
  const chanceIn = h('input', { class: 'input', type: 'number', min: '0.0001', max: '98.02', step: '0.01', value: '49.50', inputMode: 'decimal', 'aria-label': 'Win chance in percent' });
  const inputs = h('div', { class: 'limbo-inputs' },
    h('label', { class: 'field' }, 'Target multiplier', h('div', { class: 'input-group' }, targetIn, h('span', { class: 'addon' }, '×'))),
    h('label', { class: 'field' }, 'Win chance', h('div', { class: 'input-group' }, chanceIn, h('span', { class: 'addon' }, '%'))));

  stage.append(h('div', { class: 'limbo' }, h('div', { class: 'limbo-dial' }, readout, caption), meter, inputs));
  const push = resultStrip(foot);

  // ---- controls ----
  const panel = betPanel({
    play: async (amount) => {
      const t = target;
      const r = await placeBet(ctx, '/api/games/limbo/bet', { amount, params: { target: t } });
      if (!r) return;
      await climb(r.outcome.result, t, r.outcome.win, r);
      push(mult(r.outcome.result), r.outcome.win);
      return r;
    },
  });
  const stats = statRow([['Profit on win'], ['Payout on win']]);
  controls.append(panel.el, stats.el);
  panel.amount.input.addEventListener('input', update);

  // ---- linked inputs ----
  targetIn.addEventListener('input', () => {
    const v = Number(targetIn.value);
    if (!(v >= MIN && v <= MAX)) return;
    target = floor2(v);
    chanceIn.value = trimNum(chance(), 6);
    update();
  });
  chanceIn.addEventListener('input', () => {
    const c = Number(chanceIn.value);
    if (!(c > 0)) return;
    target = Math.min(MAX, Math.max(MIN, floor2(99 / c)));
    targetIn.value = target.toFixed(2);
    update();
  });
  // Normalise both fields when the user leaves them.
  const normalise = () => { targetIn.value = target.toFixed(2); chanceIn.value = trimNum(chance(), 6); update(); };
  targetIn.addEventListener('change', normalise);
  chanceIn.addEventListener('change', normalise);

  // ---- meter (log scale from 1x) ----
  let scaleMax = 10;
  const pos = (m) => Math.min(100, (Math.log(Math.max(1, m)) / Math.log(scaleMax)) * 100);
  function setScale(t, result = 1) {
    scaleMax = Math.max(10, t * 4, result * 1.25);
    meterEnd.textContent = mult(scaleMax, scaleMax >= 100 ? 0 : 1);
    pin.style.left = `${pos(t)}%`;
    pin.firstChild.textContent = mult(t);
  }

  function update() {
    const amt = panel.amount.units;
    stats.set(0, profitText(amt, target));
    stats.set(1, usd(Math.floor(amt * target)));
    if (!raf) setScale(target);
  }

  // Count up from 1.00x to the result on a log curve, then colour the outcome.
  function climb(result, t, win) {
    cancelAnimationFrame(raf);
    setScale(t, result);
    readout.classList.remove('w', 'l');
    // Long results (e.g. 1,000,000.00×) get a smaller face so they stay on one line.
    const len = mult(Math.max(result, t)).length;
    readout.style.fontSize = len > 10 ? 'clamp(30px, 6.5vw, 64px)' : len > 7 ? 'clamp(40px, 8vw, 84px)' : '';
    meter.classList.remove('w', 'l');
    caption.textContent = `Target ${mult(t)}`;
    const dur = reduced() ? 0 : Math.min(720, 260 + 110 * Math.log10(result + 1) * 2);
    const start = performance.now();
    return new Promise((done) => {
      const step = (now) => {
        const p = dur ? Math.min(1, (now - start) / dur) : 1;
        const e = 1 - Math.pow(1 - p, 3);
        const v = p >= 1 ? result : Math.max(1, floor2(Math.exp(Math.log(result) * e)));
        readout.textContent = mult(v);
        fill.style.width = `${pos(v)}%`;
        if (p < 1) { raf = requestAnimationFrame(step); return; }
        raf = 0;
        readout.classList.add(win ? 'w' : 'l');
        meter.classList.add(win ? 'w' : 'l');
        clear(caption, win ? h('span', { class: 'win' }, `Cleared ${mult(t)}`) : h('span', { class: 'loss' }, `Short of ${mult(t)}`));
        done();
      };
      raf = requestAnimationFrame(step);
    });
  }

  update();
  return () => cancelAnimationFrame(raf);
}

function trimNum(x, dp) {
  return String(Number(x.toFixed(dp)));
}
