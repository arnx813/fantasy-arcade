// Video Poker (Jacks or Better 9/6): deal five, hold any, draw once.
import { h, clear } from '../ui.js';
import { amountField, statRow } from '../betpanel.js';
import { usd, mult } from '../format.js';
import { resultStrip, placeBet, useCss } from './common.js';
import { cardEl, pace } from './cards.js';
import { PAYTABLE } from '/shared/games/videopoker.js';

const sentence = (s) => s.charAt(0) + s.slice(1).toLowerCase();

export async function mount({ controls, stage, foot, ctx }) {
  useCss('videopoker');
  let game = null, busy = false, alive = true;
  let holds = [false, false, false, false, false];

  const amount = amountField(Number(localStorage.getItem('fa:lastBet') || 1));
  const action = h('button', { class: 'btn btn-primary btn-lg btn-block' }, 'Deal');
  const stats = statRow([['Bet'], ['Hand'], ['Last win']]);
  controls.append(amount.el, action, stats.el,
    h('p', { class: 'small faint' }, 'Click cards to hold them, then draw. Keys: 1–5 hold, Space deal or draw.'),
    h('p', { class: 'small faint' }, 'Single deck, reshuffled every hand. A pair of jacks or better pays even money.'));

  // ---------- paytable ----------
  const rows = Object.fromEntries(PAYTABLE.map(([id, name, pays]) => [id, h('tr', { 'data-hand': id },
    h('th', { scope: 'row' }, sentence(name)), h('td', { class: 'vp-x' }, `${pays}×`), h('td', { class: 'vp-win' }))]));
  const table = h('table', { class: 'vp-pay', 'aria-label': 'Paytable' },
    h('thead', h('tr', h('th', 'Hand'), h('th', { class: 'vp-x' }, 'Pays'), h('th', { class: 'vp-win vp-col' }, 'Your bet'))),
    h('tbody', Object.values(rows)));

  // ---------- cards ----------
  const slots = [...Array(5)].map((_, i) => h('button', { type: 'button', class: 'vp-slot', 'aria-pressed': 'false', onClick: () => toggle(i) },
    h('div', { class: 'vp-card' }), h('span', { class: 'vp-hold' }, 'Held')));
  const message = h('div', { class: 'vp-msg', role: 'status', 'aria-live': 'polite' }, 'Place a bet and deal');
  stage.append(h('div', { class: 'vp-wrap' }, h('div', { class: 'vp-pay-wrap' }, table), message, h('div', { class: 'vp-hand' }, slots)));
  const push = resultStrip(foot);

  const showCard = (i, c, cls = '') => clear(slots[i].firstChild, cardEl(c, { cls }));
  for (let i = 0; i < 5; i++) showCard(i, null, 'still');

  function paint() {
    const s = game?.state;
    const active = game?.status === 'active';
    const bet = game ? game.baseAmount : amount.units;
    for (const [id, , pays] of PAYTABLE) {
      rows[id].querySelector('.vp-win').textContent = usd(bet * pays);
      rows[id].classList.toggle('preview', !!(active && s?.preview === id));
      rows[id].classList.toggle('hit', !!(s?.done && s.result === id));
    }
    slots.forEach((el, i) => {
      el.disabled = !active || busy;
      el.classList.toggle('on', active && holds[i]);
      el.setAttribute('aria-pressed', String(active && holds[i]));
      el.setAttribute('aria-label', `Card ${i + 1}${active && holds[i] ? ', held' : ''}`);
      el.firstChild.firstChild?.classList.toggle('held', active && holds[i]);
      el.firstChild.firstChild?.classList.toggle('dim', !!(s?.done && !s.result));
    });
    action.textContent = active ? 'Draw' : 'Deal';
    action.className = `btn btn-lg btn-block ${active ? 'btn-win' : 'btn-primary'}`;
    action.disabled = busy;
    amount.disable(active || busy);
    stats.set(0, usd(bet));
    stats.set(1, s ? (s.done ? (s.result ? nameOf(s.result) : 'No win') : (s.preview ? nameOf(s.preview) : 'Nothing yet')) : '—');
  }
  const nameOf = (id) => sentence(PAYTABLE.find((r) => r[0] === id)[1]);

  function toggle(i) {
    if (game?.status !== 'active' || busy) return;
    holds[i] = !holds[i];
    paint();
  }

  async function deal() {
    try { localStorage.setItem('fa:lastBet', amount.input.value); } catch {}
    busy = true; paint();
    try {
      const r = await placeBet(ctx, '/api/games/videopoker/start', { amount: amount.units, params: {} });
      if (!r) return;
      game = r;
      holds = [false, false, false, false, false];
      for (let i = 0; i < 5; i++) showCard(i, null, 'still');
      for (let i = 0; i < 5 && alive; i++) { await pace(110); showCard(i, r.state.hand[i], 'flip'); }
      message.textContent = r.state.preview ? `You have ${nameOf(r.state.preview).toLowerCase()}` : 'Choose cards to hold';
      message.className = 'vp-msg';
    } finally { busy = false; paint(); }
  }

  async function draw() {
    busy = true; paint();
    try {
      const r = await placeBet(ctx, '/api/games/videopoker/action', { action: 'draw', data: { holds } });
      if (!r) return;
      const old = game.state.hand;
      game = r;
      for (let i = 0; i < 5; i++) if (!holds[i]) showCard(i, null, 'still');
      for (let i = 0; i < 5 && alive; i++) {
        if (holds[i] && old[i] === r.state.hand[i]) continue;
        await pace(140);
        showCard(i, r.state.hand[i], 'flip');
      }
      holds = [false, false, false, false, false];
      const s = r.state;
      if (s.result) {
        message.replaceChildren(h('strong', nameOf(s.result)), ` pays ${usd(r.payout)}`);
        message.className = 'vp-msg win';
        stats.set(2, h('span', { class: 'win' }, usd(r.payout)));
      } else {
        message.textContent = 'No win this time';
        message.className = 'vp-msg loss';
        stats.set(2, usd(0));
      }
      push(r.payout > 0 ? mult(r.multiplier) : '0.00×', r.payout > 0);
    } finally { busy = false; paint(); }
  }

  action.addEventListener('click', () => (busy ? null : game?.status === 'active' ? draw() : deal()));
  amount.input.addEventListener('input', paint);
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-5]$/.test(e.key)) { e.preventDefault(); toggle(Number(e.key) - 1); }
    else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); action.click(); }
  };
  document.addEventListener('keydown', onKey);

  if (ctx.store.get('me')) {
    const r = await ctx.attempt(() => ctx.api.get('/api/games/videopoker/active'));
    if (r?.active) {
      game = { ...r.active, status: 'active' };
      game.state.hand.forEach((c, i) => showCard(i, c, 'still'));
      message.textContent = 'Hand in progress: choose cards to hold';
    }
  }
  paint();
  return () => { alive = false; document.removeEventListener('keydown', onKey); };
}
