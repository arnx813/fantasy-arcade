// Shared bet controls: amount with halve/double, Manual/Auto tabs, and an autobet
// runner. A game passes `play()` which places one bet and resolves to
// { amount, payout } (or undefined if the bet failed).
import { h, clear } from './ui.js';
import { toUnits, usd } from './format.js';
import { store } from './store.js';

export function amountField(initial = 1) {
  const input = h('input', { class: 'input', type: 'number', min: '0', step: '0.01', value: String(initial), inputMode: 'decimal', 'aria-label': 'Bet amount in dollars' });
  const set = (v) => { input.value = (Math.floor(v * 100) / 100).toFixed(2); input.dispatchEvent(new Event('input')); };
  const max = () => set(store.get('balance') / 1e6);
  const el = h('label', { class: 'field' },
    h('div', { class: 'field-row' }, h('span', 'Bet amount'), h('span', { class: 'faint usd-hint' })),
    h('div', { class: 'input-group' },
      h('span', { class: 'addon' }, '$'), input,
      h('button', { type: 'button', onClick: () => set(Number(input.value) / 2) }, '½'),
      h('button', { type: 'button', onClick: () => set(Number(input.value) * 2) }, '2×'),
      h('button', { type: 'button', onClick: max }, 'Max')));
  return {
    el, input,
    get units() { return Math.max(0, toUnits(input.value)); },
    set,
    disable(d) { el.querySelectorAll('input, button').forEach((x) => (x.disabled = d)); },
  };
}

export function betPanel({ play, extras = [], label = 'Bet', autobet = true, belowButton = [] }) {
  const amount = amountField(Number(localStorage.getItem('fa:lastBet') || 1));
  amount.input.addEventListener('change', () => { try { localStorage.setItem('fa:lastBet', amount.input.value); } catch {} });
  const button = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button' }, label);
  let mode = 'manual', running = false, busy = false;

  // Auto settings
  const count = h('input', { class: 'input', type: 'number', min: '0', value: '10', 'aria-label': 'Number of bets (0 for unlimited)' });
  const onWin = h('input', { class: 'input', type: 'number', value: '0', 'aria-label': 'On win, increase by percent' });
  const onLoss = h('input', { class: 'input', type: 'number', value: '0', 'aria-label': 'On loss, increase by percent' });
  const stopProfit = h('input', { class: 'input', type: 'number', min: '0', value: '0', 'aria-label': 'Stop on profit' });
  const stopLoss = h('input', { class: 'input', type: 'number', min: '0', value: '0', 'aria-label': 'Stop on loss' });
  const autoBox = h('div', { class: 'stack hidden' },
    h('label', { class: 'field' }, 'Number of bets (0 = until stopped)', count),
    h('div', { class: 'row' }, h('label', { class: 'field grow' }, 'On win, raise by %', onWin), h('label', { class: 'field grow' }, 'On loss, raise by %', onLoss)),
    h('div', { class: 'row' }, h('label', { class: 'field grow' }, 'Stop at profit $', stopProfit), h('label', { class: 'field grow' }, 'Stop at loss $', stopLoss)));

  const tabs = h('div', { class: 'seg' },
    h('button', { type: 'button', class: 'on', onClick: (e) => setMode('manual', e.target) }, 'Manual'),
    h('button', { type: 'button', onClick: (e) => setMode('auto', e.target) }, 'Auto'));
  function setMode(m, btn) {
    if (running) return;
    mode = m;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    autoBox.classList.toggle('hidden', m !== 'auto');
    button.textContent = m === 'auto' ? 'Start autobet' : label;
  }

  async function runAuto() {
    running = true;
    button.textContent = 'Stop autobet';
    const base = amount.units;
    let n = Number(count.value) || Infinity, profit = 0;
    const sp = toUnits(stopProfit.value), sl = toUnits(stopLoss.value);
    while (running && n-- > 0) {
      const r = await play(amount.units);
      if (!r) break;
      const p = r.payout - r.amount;
      profit += p;
      const pctAdj = Number(p > 0 ? onWin.value : onLoss.value) || 0;
      if (pctAdj === 0 && p !== 0) amount.set(base / 1e6);
      else if (pctAdj) amount.set((amount.units * (1 + pctAdj / 100)) / 1e6);
      if (sp && profit >= sp) break;
      if (sl && -profit >= sl) break;
      await new Promise((res) => setTimeout(res, 120));
    }
    running = false;
    button.textContent = 'Start autobet';
    amount.disable(false);
  }

  button.addEventListener('click', async () => {
    if (mode === 'auto') {
      if (running) { running = false; return; }
      amount.disable(true);
      return runAuto();
    }
    if (busy) return;
    busy = true;
    button.disabled = true;
    try { await play(amount.units); } finally { busy = false; button.disabled = false; }
  });

  const el = h('div', { class: 'stack' }, autobet ? tabs : null, amount.el, extras, autobet ? autoBox : null, button, belowButton);
  return {
    el, amount, button,
    setLabel(t) { if (mode === 'manual') button.textContent = t; },
    setDisabled(d) { button.disabled = d; },
  };
}

// Small read-only stat tiles row (e.g. Multiplier / Win chance / Profit on win).
export function statRow(items) {
  const boxes = items.map(([k]) => h('div', { class: 'stat-box' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, '—')));
  const el = h('div', { class: 'stat-row' }, boxes);
  return { el, set: (i, v) => clear(boxes[i].querySelector('.v'), v) };
}

export const profitText = (amountUnits, multiplier) => usd(Math.floor(amountUnits * multiplier) - amountUnits);
