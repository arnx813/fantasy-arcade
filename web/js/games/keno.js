// Keno: pick 1-10 of 40 numbers, the server draws 10. Picks persist between bets.
import { h, clear, toast } from '../ui.js';
import { betPanel } from '../betpanel.js';
import { usd } from '../format.js';
import { resultStrip, placeBet, useCss, sleep, fmtMult } from './common.js';
import { KENO } from '/shared/tables.js';

const GEM = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 5l13 11-13 19L7 16z" fill="#45e0a8"/><path d="M20 5l6 11h-12zM7 16h26L20 35z" fill="#fff" opacity="0.35"/></svg>';
const RISKS = [['classic', 'Classic'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const MAX_PICKS = 10;
// Compact multiplier for the narrow payout chips: 0×, 1.73×, 27×, 2,850×.
const payMult = (m) => (m === 0 ? '0×' : `${Number(m >= 10 ? m.toFixed(m >= 100 ? 0 : 1) : m.toFixed(2)).toLocaleString('en-US')}×`);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mount({ controls, stage, foot, ctx }) {
  useCss('keno');
  const picks = new Set();
  let risk = 'classic', drawing = false;

  // ---- controls ----
  const riskSel = h('select', { class: 'input', 'aria-label': 'Risk' }, RISKS.map(([v, l]) => h('option', { value: v, selected: v === risk }, l)));
  riskSel.addEventListener('change', () => { risk = riskSel.value; resetMarks(); paintPays(); });
  const autoBtn = h('button', { type: 'button', class: 'btn grow', onClick: autoPick }, 'Auto pick');
  const clearBtn = h('button', { type: 'button', class: 'btn grow', onClick: () => { if (drawing) return; picks.clear(); resetMarks(); paintBoard(); } }, 'Clear');
  const count = h('span', { class: 'faint' });

  const panel = betPanel({
    extras: [
      h('label', { class: 'field' }, 'Risk', riskSel),
      h('div', { class: 'row' }, autoBtn, clearBtn),
    ],
    belowButton: [h('div', { class: 'small keno-count' }, count)],
    play,
  });
  controls.append(panel.el);

  // ---- board ----
  const tiles = [...Array(40)].map((_, i) => h('button', {
    type: 'button', class: 'keno-tile', 'aria-pressed': 'false', 'aria-label': `Number ${i + 1}`,
    onClick: () => toggle(i + 1),
  }, h('span', { class: 'n' }, String(i + 1))));
  const board = h('div', { class: 'keno-board', role: 'group', 'aria-label': 'Keno board' }, tiles);
  const pays = h('div', { class: 'keno-pays', 'aria-label': 'Payouts by hits' });
  const status = h('div', { class: 'keno-status', role: 'status', 'aria-live': 'polite' });
  stage.append(h('div', { class: 'keno-wrap' }, board, pays, status));
  const push = resultStrip(foot);

  function toggle(n) {
    if (drawing) return;
    if (picks.has(n)) picks.delete(n);
    else if (picks.size >= MAX_PICKS) return toast(`You can pick up to ${MAX_PICKS} numbers`, 'info', 1800);
    else picks.add(n);
    resetMarks();
    paintBoard();
  }

  function autoPick() {
    if (drawing) return;
    picks.clear();
    const pool = [...Array(40)].map((_, i) => i + 1);
    for (let i = 0; i < MAX_PICKS; i++) picks.add(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    resetMarks();
    paintBoard();
  }

  // Clears the last draw's marks (drawn/hit/miss) but keeps the picks.
  function resetMarks() {
    tiles.forEach((t, i) => {
      t.classList.remove('drawn', 'hit', 'miss');
      t.innerHTML = `<span class="n">${i + 1}</span>`;
    });
    pays.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
    status.textContent = '';
  }

  function paintBoard() {
    tiles.forEach((t, i) => {
      const on = picks.has(i + 1);
      t.classList.toggle('picked', on);
      t.setAttribute('aria-pressed', String(on));
    });
    count.textContent = picks.size ? `${picks.size} of ${MAX_PICKS} picked` : 'Pick up to 10 numbers on the board';
    paintPays();
  }

  function paintPays() {
    const n = picks.size;
    if (!n) return clear(pays, h('div', { class: 'keno-pays-empty faint small' }, 'Pick numbers to see what each hit count pays'));
    const row = KENO[risk][n];
    pays.style.setProperty('--cols', row.length > 7 ? Math.ceil(row.length / 2) : row.length);
    clear(pays, row.map((m, k) => h('div', { class: `keno-pay ${m === 0 ? 'zero' : ''}`, 'data-k': k },
      h('div', { class: 'm' }, payMult(m)),
      h('div', { class: 'k' }, `${k} ${k === 1 ? 'hit' : 'hits'}`))));
  }

  function lock(d) {
    drawing = d;
    board.classList.toggle('busy', d);
    riskSel.disabled = d;
    autoBtn.disabled = d;
    clearBtn.disabled = d;
  }

  async function play(amount) {
    if (drawing) return undefined;
    if (!picks.size) { toast('Pick at least one number first', 'error'); return undefined; }
    const r = await placeBet(ctx, '/api/games/keno/bet', { amount, params: { picks: [...picks], risk } });
    if (!r) return undefined;
    lock(true);
    resetMarks();
    const fast = reduced();
    try {
      for (const n of r.outcome.drawn) {
        const t = tiles[n - 1];
        if (picks.has(n)) { t.classList.add('hit'); t.innerHTML = `${GEM}<span class="n">${n}</span>`; }
        else t.classList.add('drawn');
        if (!fast) await sleep(70);
      }
      tiles.forEach((t, i) => picks.has(i + 1) && !t.classList.contains('hit') && t.classList.add('miss'));
      const hits = r.outcome.hits.length;
      pays.querySelector(`[data-k="${hits}"]`)?.classList.add('on');
      status.className = `keno-status ${r.payout > 0 ? 'win' : ''}`;
      status.textContent = r.payout > 0
        ? `${hits} ${hits === 1 ? 'hit' : 'hits'} · ${fmtMult(r.multiplier)} · won ${usd(r.payout)}`
        : `${hits} ${hits === 1 ? 'hit' : 'hits'} · no payout`;
      push(fmtMult(r.multiplier), r.payout > 0);
    } finally {
      lock(false);
    }
    return r;
  }

  paintBoard();
}
