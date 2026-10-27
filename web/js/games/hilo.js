// HiLo: guess whether the next card is higher or lower, skip cards, cash out any time
// after a correct guess. Aces are low, kings are high.
import { h, clear } from '../ui.js';
import { amountField, statRow } from '../betpanel.js';
import { usd, mult } from '../format.js';
import { resultStrip, placeBet, useCss } from './common.js';
import { cardEl, pace } from './cards.js';
import { RANKS, rankOf } from '/shared/fair.js';

const CHOICE = {
  higher_eq: ['Higher or same', '▲'],
  lower_eq: ['Lower or same', '▼'],
  higher: ['Higher', '▲'],
  lower: ['Lower', '▼'],
  same: ['Same', '='],
};
const GUESS_TAG = { higher_eq: '▲', lower_eq: '▼', higher: '▲', lower: '▼', same: '=', skip: 'Skip' };

export async function mount({ controls, stage, foot, ctx }) {
  useCss('hilo');
  let game = null, busy = false, alive = true;

  const amount = amountField(Number(localStorage.getItem('fa:lastBet') || 1));
  const main = h('button', { class: 'btn btn-primary btn-lg btn-block' }, 'Bet');
  const stats = statRow([['Multiplier'], ['Payout']]);
  controls.append(amount.el, main, stats.el,
    h('p', { class: 'small faint' }, 'Aces are low, kings are high. A correct guess compounds your multiplier; skipping is free.'),
    h('p', { class: 'small faint' }, 'Keys: Q first choice, W second choice, S skip, C cash out'));

  // ---------- stage ----------
  const deckEl = h('div', { class: 'hl-deck', 'aria-hidden': 'true' }, cardEl(null, { cls: 'still' }), cardEl(null, { cls: 'still' }));
  const currentEl = h('div', { class: 'hl-current', 'aria-live': 'polite' });
  const runMult = h('div', { class: 'hl-mult' }, '1.00×');
  const choiceBtns = [0, 1].map((i) => h('button', { type: 'button', class: `hl-choice c${i}`, onClick: () => guess(i) }));
  const skip = h('button', { type: 'button', class: 'btn hl-skip', onClick: () => act({ action: 'skip' }) }, 'Skip card');
  const cashout = h('button', { type: 'button', class: 'btn btn-win hl-cash', onClick: () => act({ action: 'cashout' }) }, 'Cash out');
  const scale = h('div', { class: 'hl-scale', 'aria-hidden': 'true' }, RANKS.map((r) => h('span', r)));
  const hist = h('div', { class: 'hl-history', 'aria-label': 'Cards this round' });
  const histWrap = h('div', { class: 'hl-history-wrap' }, hist);
  stage.append(h('div', { class: 'hl-wrap' },
    h('div', { class: 'hl-top' }, h('div', { class: 'hl-side' }, choiceBtns[0]), h('div', { class: 'hl-centre' }, deckEl, currentEl), h('div', { class: 'hl-side' }, choiceBtns[1])),
    scale,
    h('div', { class: 'hl-bar' }, skip, h('div', { class: 'hl-run' }, h('span', { class: 'small faint' }, 'Running multiplier'), runMult), cashout),
    histWrap));
  const push = resultStrip(foot);

  function setCurrent(c, flip) {
    clear(currentEl, cardEl(c, { cls: flip ? 'flip' : 'still' }));
    scale.querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', c !== null && c !== undefined && rankOf(c) === i));
  }

  function renderHistory(s, start) {
    const items = [];
    if (start !== undefined) items.push(h('div', { class: 'hl-hcard start' }, cardEl(start, { cls: 'still' }), h('span', { class: 'hl-tag' }, 'Start')));
    for (const x of s?.history || []) {
      items.push(h('div', { class: `hl-hcard ${x.won === true ? 'won' : x.won === false ? 'lost' : 'skip'}` },
        cardEl(x.card, { cls: 'still' }), h('span', { class: 'hl-tag' }, GUESS_TAG[x.choice])));
    }
    clear(hist, items);
    histWrap.scrollLeft = histWrap.scrollWidth;
  }

  function paint() {
    const s = game?.state;
    const active = game?.status === 'active';
    choiceBtns.forEach((b, i) => {
      const c = s?.choices?.[i];
      const [label, icon] = c ? CHOICE[c.choice] : [i ? 'Lower or same' : 'Higher or same', i ? '▼' : '▲'];
      clear(b, h('span', { class: 'hl-ico', 'aria-hidden': 'true' }, icon), h('strong', label),
        h('span', { class: 'hl-odds' }, c && active ? `${(c.chance * 100).toFixed(2)}% · ${mult(c.multiplier)}` : '—'));
      b.disabled = !active || busy;
      b.setAttribute('aria-keyshortcuts', i ? 'W' : 'Q');
    });
    skip.disabled = !active || busy;
    cashout.disabled = !active || busy || !s?.canCashout;
    const m = s ? (s.busted ? 0 : s.multiplier) : 1;
    runMult.textContent = mult(m);
    runMult.className = `hl-mult ${s?.busted ? 'loss' : m > 1 ? 'win' : ''}`;
    stats.set(0, mult(m));
    stats.set(1, game ? usd(Math.floor(game.baseAmount * (s.busted ? 0 : s.multiplier))) : usd(0));
    cashout.textContent = active && s.canCashout ? `Cash out ${usd(Math.floor(game.baseAmount * s.multiplier))}` : 'Cash out';
    main.textContent = active ? (s.canCashout ? `Cash out ${usd(Math.floor(game.baseAmount * s.multiplier))}` : 'Make a guess') : 'Bet';
    main.className = `btn btn-lg btn-block ${active ? 'btn-win' : 'btn-primary'}`;
    main.disabled = busy || (active && !s.canCashout);
    amount.disable(active || busy);
  }

  async function start() {
    try { localStorage.setItem('fa:lastBet', amount.input.value); } catch {}
    busy = true; paint();
    try {
      const r = await placeBet(ctx, '/api/games/hilo/start', { amount: amount.units, params: {} });
      if (!r) return;
      game = r;
      startCard = r.state.current;
      setCurrent(r.state.current, true);
      renderHistory(r.state, startCard);
    } finally { busy = false; paint(); }
  }

  let startCard;
  async function act(body) {
    if (busy || game?.status !== 'active') return;
    busy = true; paint();
    try {
      const r = await placeBet(ctx, '/api/games/hilo/action', body);
      if (!r) return;
      const moved = r.state.history.length > game.state.history.length;
      game = r;
      if (moved) {
        currentEl.classList.add('leaving');
        await pace(160);
        currentEl.classList.remove('leaving');
        setCurrent(r.state.current, true);
        renderHistory(r.state, startCard);
        const last = r.state.history.at(-1);
        if (last.won !== null) flash(last.won);
      }
      if (r.status === 'settled') {
        push(r.payout > 0 ? mult(r.multiplier) : '0.00×', r.payout > 0);
        if (r.payout > 0) celebrate(r);
      }
    } finally { busy = false; paint(); }
  }
  const guess = (i) => { const c = game?.state?.choices?.[i]; if (c) act({ action: 'guess', data: { choice: c.choice } }); };

  function flash(won) {
    currentEl.classList.remove('ok', 'bad');
    void currentEl.offsetWidth;
    currentEl.classList.add(won ? 'ok' : 'bad');
  }
  function celebrate(r) {
    const card = h('div', { class: 'win-card' }, h('div', { class: 'display', style: { fontSize: '30px' } }, mult(r.multiplier)), h('div', usd(r.payout)));
    stage.append(card);
    setTimeout(() => card.remove(), 1600);
  }

  main.addEventListener('click', () => (game?.status === 'active' ? act({ action: 'cashout' }) : start()));
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'q') guess(0);
    else if (k === 'w') guess(1);
    else if (k === 's') act({ action: 'skip' });
    else if (k === 'c' && game?.state?.canCashout) act({ action: 'cashout' });
  };
  document.addEventListener('keydown', onKey);

  setCurrent(null);
  if (ctx.store.get('me')) {
    const r = await ctx.attempt(() => ctx.api.get('/api/games/hilo/active'));
    if (r?.active) {
      game = { ...r.active, status: 'active' };
      const s = game.state;
      startCard = s.history.length ? s.history[0].from : s.current;
      setCurrent(s.current);
      renderHistory(s, startCard);
    }
  }
  paint();
  return () => { alive = false; document.removeEventListener('keydown', onKey); };
}
