// Mines: start a round, reveal tiles, cash out. The server keeps the mine layout;
// it is only sent once the round ends.
import { h, clear } from '../ui.js';
import { amountField, statRow } from '../betpanel.js';
import { usd, mult } from '../format.js';
import { resultStrip, placeBet } from './common.js';
import { minesMultiplier } from '/shared/games/mines.js';

const GEM = '<svg viewBox="0 0 40 40"><path d="M20 4l14 12-14 20L6 16z" fill="#45e0a8"/><path d="M20 4l6 12h-12zM6 16h28L20 36z" fill="#fff" opacity="0.35"/></svg>';
const BOMB = '<svg viewBox="0 0 40 40"><circle cx="19" cy="23" r="12" fill="#ff5d73"/><circle cx="15" cy="19" r="3" fill="#fff" opacity="0.6"/><path d="M26 13l5-5" stroke="#ffd23f" stroke-width="3" stroke-linecap="round"/></svg>';

export async function mount({ controls, stage, foot, ctx }) {
  let game = null, mines = 3;
  const amount = amountField(1);
  const minesSel = h('select', { class: 'input', 'aria-label': 'Mines' }, [...Array(24)].map((_, i) => h('option', { value: i + 1, selected: i + 1 === mines }, String(i + 1))));
  const gemsInfo = h('input', { class: 'input', readOnly: true, value: String(25 - mines), 'aria-label': 'Gems' });
  minesSel.addEventListener('change', () => { mines = Number(minesSel.value); gemsInfo.value = String(25 - mines); });
  const action = h('button', { class: 'btn btn-primary btn-lg btn-block' }, 'Bet');
  const random = h('button', { class: 'btn btn-block hidden' }, 'Pick random tile');
  const stats = statRow([['Current'], ['Next tile'], ['Payout']]);
  controls.append(amount.el, h('div', { class: 'row' }, h('label', { class: 'field grow' }, 'Mines', minesSel), h('label', { class: 'field grow' }, 'Gems', gemsInfo)),
    action, random, stats.el);

  const grid = h('div', { class: 'mines-grid', role: 'grid', 'aria-label': 'Mines board' });
  const tiles = [...Array(25)].map((_, i) => h('button', { class: 'mine-tile', 'aria-label': `Tile ${i + 1}`, onClick: () => reveal(i) }));
  grid.append(...tiles);
  stage.append(grid);
  const push = resultStrip(foot);

  function paint() {
    const s = game?.state;
    const active = game && game.status === 'active';
    tiles.forEach((t, i) => {
      const revealed = s?.revealed.includes(i);
      const isMine = s?.mineSet?.includes(i);
      t.className = 'mine-tile' + (revealed ? ' open' : '') + (s?.done && !revealed ? ' ghost' : '') + (revealed && isMine ? ' boom' : '');
      t.innerHTML = revealed || s?.done ? (isMine ? BOMB : s?.mineSet || revealed ? GEM : '') : '';
      t.disabled = !active || revealed;
    });
    action.textContent = active ? (s.revealed.length ? `Cash out ${usd(Math.floor(game.baseAmount * s.multiplier))}` : 'Pick a tile') : 'Bet';
    action.disabled = active && !s.revealed.length;
    action.className = `btn btn-lg btn-block ${active ? 'btn-win' : 'btn-primary'}`;
    random.classList.toggle('hidden', !active);
    amount.disable(!!active);
    minesSel.disabled = !!active;
    const k = s ? s.revealed.filter((t) => !s.mineSet?.includes(t)).length : 0;
    const m = s ? s.mines : mines;
    stats.set(0, mult(minesMultiplier(m, k)));
    stats.set(1, k < 25 - m ? mult(minesMultiplier(m, k + 1)) : '—');
    stats.set(2, game && !s.busted ? usd(Math.floor(game.baseAmount * minesMultiplier(m, k))) : usd(0));
  }

  async function start() {
    const r = await placeBet(ctx, '/api/games/mines/start', { amount: amount.units, params: { mines } });
    if (r) { game = r; paint(); }
  }
  async function act(body) {
    const r = await placeBet(ctx, '/api/games/mines/action', body);
    if (!r) return;
    game = r;
    if (r.status === 'settled') {
      push(r.payout > 0 ? mult(r.multiplier) : '0.00×', r.payout > 0);
      if (r.payout > 0) celebrate(r);
    }
    paint();
  }
  const reveal = (tile) => game?.status === 'active' && act({ action: 'reveal', data: { tile } });
  action.addEventListener('click', () => (game?.status === 'active' ? act({ action: 'cashout' }) : start()));
  random.addEventListener('click', () => {
    const hidden = tiles.map((_, i) => i).filter((i) => !game.state.revealed.includes(i));
    reveal(hidden[Math.floor(Math.random() * hidden.length)]);
  });
  function celebrate(r) {
    const card = h('div', { class: 'win-card' }, h('div', { class: 'display', style: { fontSize: '30px' } }, mult(r.multiplier)), h('div', usd(r.payout)));
    stage.append(card);
    setTimeout(() => card.remove(), 1600);
  }

  // Resume a round left open (refresh, another tab).
  if (ctx.store.get('me')) {
    const { active } = await ctx.api.get('/api/games/mines/active');
    if (active) game = { ...active, status: 'active' };
  }
  paint();
}
