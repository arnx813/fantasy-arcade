// Tower: climb nine floors by picking a safe door on each. The server keeps the
// layout and only sends it once the round ends.
import { h } from '../ui.js';
import { amountField, statRow } from '../betpanel.js';
import { usd, mult } from '../format.js';
import { resultStrip, placeBet, useCss, fmtMult } from './common.js';
import { TOWER_MODES, TOWER_LEVELS, towerMultiplier } from '/shared/games/tower.js';

const STAR = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4l4.6 10 10.9 1.2-8.1 7.4 2.3 10.8L20 27.9l-9.7 5.5 2.3-10.8-8.1-7.4L15.4 14z" fill="#ffd23f"/><path d="M20 4l4.6 10L20 20z" fill="#fff" opacity="0.35"/></svg>';
const SKULL = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 6c-8 0-13 5.5-13 12.5 0 4 1.8 6.8 4.5 8.5V32h17v-5c2.7-1.7 4.5-4.5 4.5-8.5C33 11.5 28 6 20 6z" fill="#ff5d73"/><circle cx="15" cy="19" r="3.2" fill="#121217"/><circle cx="25" cy="19" r="3.2" fill="#121217"/><path d="M17 32v-4M20 32v-4M23 32v-4" stroke="#121217" stroke-width="1.6"/></svg>';
const MODES = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['expert', 'Expert'], ['master', 'Master']];

export async function mount({ controls, stage, foot, ctx }) {
  useCss('tower');
  let game = null, mode = 'easy', busy = false;

  const amount = amountField(1);
  const modeSel = h('select', { class: 'input', 'aria-label': 'Difficulty' }, MODES.map(([v, l]) => h('option', { value: v, selected: v === mode }, l)));
  const doorsInfo = h('div', { class: 'small faint' });
  modeSel.addEventListener('change', () => { mode = modeSel.value; game = null; build(); paint(); });
  const action = h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block' }, 'Bet');
  const random = h('button', { type: 'button', class: 'btn btn-block hidden' }, 'Pick random door');
  const stats = statRow([['Current'], ['Next floor'], ['Payout']]);
  controls.append(amount.el, h('label', { class: 'field' }, 'Difficulty', modeSel), doorsInfo, action, random, stats.el);

  const tower = h('div', { class: 'tower', role: 'grid', 'aria-label': 'Tower' });
  stage.append(h('div', { class: 'tower-wrap' }, tower));
  const push = resultStrip(foot);
  let floors = [];

  const curMode = () => game?.state?.difficulty || mode;

  // Floors are built top-down in the DOM (floor 8 first) so the tower reads bottom-up.
  function build() {
    const m = curMode();
    const { cols } = TOWER_MODES[m];
    floors = [...Array(TOWER_LEVELS)].map((_, L) => {
      const doors = [...Array(cols)].map((_, c) => h('button', {
        type: 'button', class: 'tower-door', 'aria-label': `Floor ${L + 1}, door ${c + 1}`,
        onClick: () => pick(L, c),
      }));
      const el = h('div', { class: 'tower-floor', role: 'row' },
        h('div', { class: 'tower-doors' }, doors),
        h('div', { class: 'tower-mult' }, fmtMult(towerMultiplier(m, L + 1))));
      el.style.setProperty('--cols', cols);
      return { el, doors };
    });
    tower.replaceChildren(...[...floors].reverse().map((f) => f.el));
    const { safe } = TOWER_MODES[m];
    doorsInfo.textContent = `${cols} doors per floor, ${safe} safe`;
  }

  function paint() {
    const s = game?.state;
    const active = game?.status === 'active';
    const level = s ? s.level : 0;
    floors.forEach((f, L) => {
      const current = active && L === level;
      f.el.classList.toggle('current', current);
      f.el.classList.toggle('cleared', !!s && L < level && !(s.busted && L === s.picks.length - 1));
      f.el.classList.toggle('above', !!s && (active ? L > level : L >= s.picks.length));
      f.doors.forEach((d, c) => {
        const picked = s?.picks[L] === c;
        const safe = s?.layout ? s.layout[L].includes(c) : picked && L < level;
        const bust = picked && s?.busted && L === s.picks.length - 1;
        d.className = 'tower-door' + (picked ? ' picked' : '') + (bust ? ' bust' : '') +
          (s?.done && !picked && s.layout ? ' ghost' : '') + (safe && !bust ? ' safe' : '');
        d.innerHTML = bust ? SKULL : safe && (picked || s?.layout) ? STAR : s?.layout && !safe ? SKULL : '';
        d.disabled = !current || busy;
      });
    });
    action.textContent = active ? (level ? `Cash out ${usd(Math.floor(game.baseAmount * s.multiplier))}` : 'Pick a door') : 'Bet';
    action.disabled = busy || (active && !level);
    action.className = `btn btn-lg btn-block ${active ? 'btn-win' : 'btn-primary'}`;
    random.classList.toggle('hidden', !active);
    random.disabled = busy;
    amount.disable(!!active);
    modeSel.disabled = !!active;
    const m = curMode();
    stats.set(0, mult(towerMultiplier(m, active || (s && !s.busted) ? level : 0)));
    stats.set(1, level < TOWER_LEVELS ? mult(towerMultiplier(m, level + 1)) : '—');
    stats.set(2, game && !s.busted ? usd(Math.floor(game.baseAmount * towerMultiplier(m, level))) : usd(0));
  }

  async function run(path, body) {
    if (busy) return;
    busy = true;
    paint();
    let r;
    try { r = await placeBet(ctx, path, body); } finally { busy = false; }
    if (r) {
      const fresh = !game || game.id !== r.id;
      game = r;
      if (fresh && r.state.difficulty !== mode) { mode = r.state.difficulty; modeSel.value = mode; }
      if (fresh) build();
      if (r.status === 'settled') {
        push(r.payout > 0 ? mult(r.multiplier) : '0.00×', r.payout > 0);
        if (r.payout > 0) celebrate(r);
      }
    }
    paint();
  }

  const pick = (L, col) => game?.status === 'active' && L === game.state.level && run('/api/games/tower/action', { action: 'pick', data: { col } });
  action.addEventListener('click', () => (game?.status === 'active'
    ? run('/api/games/tower/action', { action: 'cashout' })
    : run('/api/games/tower/start', { amount: amount.units, params: { difficulty: mode } })));
  random.addEventListener('click', () => {
    if (game?.status !== 'active') return;
    pick(game.state.level, Math.floor(Math.random() * TOWER_MODES[game.state.difficulty].cols));
  });

  function celebrate(r) {
    const card = h('div', { class: 'win-card' }, h('div', { class: 'display', style: { fontSize: '30px' } }, mult(r.multiplier)), h('div', usd(r.payout)));
    stage.append(card);
    setTimeout(() => card.remove(), 1600);
  }

  // Resume a round left open (refresh, another tab).
  if (ctx.store.get('me')) {
    const res = await ctx.api.get('/api/games/tower/active').catch(() => null);
    if (res?.active) {
      game = { ...res.active, status: 'active' };
      mode = game.state.difficulty;
      modeSel.value = mode;
    }
  }
  build();
  paint();
}
