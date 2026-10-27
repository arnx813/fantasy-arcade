// Demo provider slot client. Stands in for a third-party game running inside the
// casino's iframe: it only knows its launch token and talks to the provider spin
// endpoint, which settles through the casino's seamless wallet.
const params = new URLSearchParams(location.search);
const TOKEN = params.get('token') || '';
const GAME = params.get('game') || '';

const UNIT = 1_000_000;
const BETS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
const SYMBOLS = ['cherry', 'lemon', 'bell', 'gem', 'star', 'seven'];
const NAMES = { cherry: 'Cherry', lemon: 'Lemon', bell: 'Bell', gem: 'Gem', star: 'Star', seven: 'Seven' };
// Line i: row index on each of the three columns.
const LINES = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]];
const LINE_COLORS = ['#ffd23f', '#45e0a8', '#7cb8ff', '#ff7ad9', '#ff9a4d'];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- original symbol art (simple shapes, 100x100) ----
const ART = {
  cherry: `<path d="M50 16c6 14 14 24 26 30" stroke="#3fa65a" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M50 16c-4 16-12 28-20 36" stroke="#3fa65a" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M50 16c10-6 22-6 30 2-10 6-20 6-30-2z" fill="#5fd47a"/>
    <circle cx="30" cy="66" r="18" fill="#ff4d6d"/><circle cx="72" cy="62" r="18" fill="#e8314f"/>
    <circle cx="24" cy="60" r="5" fill="#fff" opacity="0.55"/><circle cx="66" cy="56" r="5" fill="#fff" opacity="0.55"/>`,
  lemon: `<ellipse cx="50" cy="54" rx="34" ry="26" fill="#ffe14d" transform="rotate(-18 50 54)"/>
    <path d="M18 66l-7 4 3-8zM82 42l7-4-3 8z" fill="#ffe14d"/>
    <ellipse cx="40" cy="46" rx="12" ry="5" fill="#fff" opacity="0.45" transform="rotate(-18 40 46)"/>
    <path d="M62 30c4-8 12-10 18-8-4 6-10 9-18 8z" fill="#5fd47a"/>`,
  bell: `<path d="M50 14c-16 0-24 14-24 30v14l-8 12h64l-8-12V44c0-16-8-30-24-30z" fill="#ffb320"/>
    <rect x="16" y="68" width="68" height="8" rx="4" fill="#d98a00"/>
    <circle cx="50" cy="84" r="8" fill="#d98a00"/><circle cx="50" cy="12" r="5" fill="#d98a00"/>
    <path d="M38 26c-6 6-8 14-8 26" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.5"/>`,
  gem: `<path d="M50 86L12 40l14-20h48l14 20z" fill="#3fd0f0"/>
    <path d="M12 40h76L50 86z" fill="#1f9fd0"/><path d="M26 20l10 20h28l10-20z" fill="#8ff0ff"/>
    <path d="M36 40l14 46 14-46z" fill="#3fd0f0"/><path d="M26 20l10 20-24 0z" fill="#bff7ff" opacity="0.8"/>`,
  star: `<path d="M50 10l11 25 27 3-20 18 6 27-24-14-24 14 6-27-20-18 27-3z" fill="#b48cff" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="50" cy="52" r="10" fill="#fff" opacity="0.4"/>`,
  seven: `<rect x="12" y="12" width="76" height="76" rx="16" fill="#2a1d4a" stroke="#ff5d73" stroke-width="5"/>
    <path d="M28 28h44v10L50 76H37l21-36H28z" fill="#ff5d73"/>
    <path d="M28 28h44v6H28z" fill="#fff" opacity="0.35"/>`,
};
const svg = (name) => `<svg viewBox="0 0 100 100" role="img" aria-label="${NAMES[name]}">${ART[name]}</svg>`;

// ---- elements ----
const $ = (id) => document.getElementById(id);
const reels = [...document.querySelectorAll('.reel')].map((el) => ({ el, strip: el.querySelector('.strip') }));
const linesSvg = $('lines');
const betSel = $('bet');
const spinBtn = $('spin');
const balEl = $('balance');
const winEl = $('win');
const msg = $('msg');
const banner = $('banner');
const paytable = $('paytable');
const payBtn = $('payBtn');

const usd = (u) => '$' + (u / UNIT).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rand = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
const cell = (name) => `<div class="cell" data-sym="${name}">${svg(name)}</div>`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pays = null, spinning = false;
let grid = [0, 1, 2].map(() => [rand(), rand(), rand()]);

// ---- title ----
const title = GAME.includes(':') ? GAME.split(':').pop() : GAME;
if (title) {
  const pretty = title.replace(/[-_]+/g, ' ').replace(/\b\w/, (c) => c.toUpperCase());
  $('title').textContent = pretty;
  document.title = pretty;
}
// The catalog is public; use the real display name when it is there.
fetch('/api/games', { credentials: 'omit' }).then((r) => r.json()).then(({ providers = [] }) => {
  const g = providers.find((x) => x.id === GAME);
  if (g) { $('title').textContent = g.name; document.title = g.name; }
}).catch(() => {});

// ---- bet selector ----
let betIdx = 3;
try { const saved = Number(localStorage.getItem('demo:bet')); if (BETS.includes(saved)) betIdx = BETS.indexOf(saved); } catch {}
betSel.innerHTML = BETS.map((b, i) => `<option value="${i}">$${b.toFixed(2)}</option>`).join('');
const setBet = (i) => {
  betIdx = Math.max(0, Math.min(BETS.length - 1, i));
  betSel.value = String(betIdx);
  $('betDown').disabled = spinning || betIdx === 0;
  $('betUp').disabled = spinning || betIdx === BETS.length - 1;
  try { localStorage.setItem('demo:bet', String(BETS[betIdx])); } catch {}
  if (pays) renderPaytable();
};
betSel.addEventListener('change', () => setBet(Number(betSel.value)));
$('betDown').addEventListener('click', () => setBet(betIdx - 1));
$('betUp').addEventListener('click', () => setBet(betIdx + 1));
setBet(betIdx);

// ---- reels ----
function showGrid() {
  reels.forEach((r, c) => {
    r.strip.style.transition = 'none';
    r.strip.style.transform = 'translateY(0)';
    r.strip.innerHTML = grid[c].map(cell).join('');
  });
}

// Each reel gets a strip of filler symbols ending in its three result symbols; it
// slides down so the result lands in the window. Later reels run longer.
async function spinTo(next) {
  if (reduced()) {
    grid = next;
    showGrid();
    return;
  }
  const cellH = reels[0].el.clientHeight / 3;
  const done = reels.map((r, c) => {
    const filler = 14 + c * 6;
    const syms = [...next[c], ...[...Array(filler)].map(rand), ...grid[c]];
    r.strip.style.transition = 'none';
    r.strip.innerHTML = syms.map(cell).join('');
    const end = 0, start = -(syms.length - 3) * cellH;
    r.strip.style.transform = `translateY(${start}px)`;
    r.el.classList.add('spinning');
    void r.strip.offsetHeight;
    const ms = 700 + c * 320;
    r.strip.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0.6, 0.3, 1.04)`;
    r.strip.style.transform = `translateY(${end}px)`;
    return new Promise((res) => setTimeout(() => {
      r.el.classList.remove('spinning');
      r.strip.style.transition = 'none';
      r.strip.innerHTML = next[c].map(cell).join('');
      r.strip.style.transform = 'translateY(0)';
      res();
    }, ms + 30));
  });
  await Promise.all(done);
  grid = next;
}

function drawLines(hits) {
  linesSvg.innerHTML = hits.map((i) => {
    const pts = LINES[i].map((row, col) => `${50 + col * 100},${50 + row * 100}`).join(' ');
    return `<polyline points="${pts}" stroke="${LINE_COLORS[i]}" />`;
  }).join('');
  reels.forEach((r, c) => r.strip.querySelectorAll('.cell').forEach((el, row) => {
    el.classList.toggle('lit', hits.some((i) => LINES[i][c] === row));
  }));
}

// ---- paytable ----
function renderPaytable() {
  const lineBet = (BETS[betIdx] * UNIT) / LINES.length;
  $('ptGrid').innerHTML = [...SYMBOLS].reverse().map((s) => `
    <div class="pt-row">
      <div class="pt-syms">${svg(s)}${svg(s)}${svg(s)}</div>
      <div class="pt-pay"><b>${pays[s]}×</b><span>${usd(Math.floor(lineBet * pays[s]))}</span></div>
    </div>`).join('');
  $('ptLines').innerHTML = LINES.map((l, i) => {
    const x0 = i * 66 + 8;
    const box = `<rect x="${x0}" y="6" width="54" height="54" rx="6" fill="none" stroke="rgba(255,255,255,0.25)"/>`;
    const pts = l.map((row, col) => `${x0 + 9 + col * 18},${15 + row * 18}`).join(' ');
    return `${box}<polyline points="${pts}" fill="none" stroke="${LINE_COLORS[i]}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
}
function togglePaytable(open = paytable.classList.contains('hidden')) {
  if (open && !pays) { setMsg('The paytable loads with your first spin.'); return; }
  paytable.classList.toggle('hidden', !open);
  payBtn.setAttribute('aria-expanded', String(open));
  if (open) renderPaytable();
}
payBtn.addEventListener('click', () => togglePaytable());
$('payClose').addEventListener('click', () => togglePaytable(false));

// ---- spin ----
function setMsg(t, kind = '') { msg.textContent = t; msg.className = `msg ${kind}`; }
function lock(d) {
  spinning = d;
  spinBtn.disabled = d;
  betSel.disabled = d;
  setBet(betIdx);
}

async function spin() {
  if (spinning) return;
  if (!TOKEN) { setMsg('This game needs a launch session. Open it from the casino.', 'err'); return; }
  lock(true);
  drawLines([]);
  banner.classList.add('hidden');
  setMsg('Good luck');
  const bet = Math.round(BETS[betIdx] * UNIT);
  let data;
  try {
    const res = await fetch('/api/provider-demo/spin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ token: TOKEN, bet }),
    });
    data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Spin failed (${res.status})`);
  } catch (e) {
    setMsg(e.message || 'Spin failed', 'err');
    lock(false);
    return;
  }
  pays = data.pays;
  await spinTo(data.grid);
  balEl.textContent = usd(data.balance);
  winEl.textContent = usd(data.win);
  drawLines(data.hits);
  if (data.win > 0) {
    const n = data.hits.length;
    setMsg(`${n} winning ${n === 1 ? 'line' : 'lines'}`, 'ok');
    banner.textContent = `Win ${usd(data.win)}`;
    banner.classList.remove('hidden');
    winEl.parentElement.classList.add('hot');
    if (!reduced()) await sleep(250);
  } else {
    winEl.parentElement.classList.remove('hot');
    setMsg('No win this spin');
  }
  if (!paytable.classList.contains('hidden')) renderPaytable();
  lock(false);
}
spinBtn.addEventListener('click', spin);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && !['SELECT', 'BUTTON', 'INPUT'].includes(document.activeElement?.tagName)) {
    e.preventDefault();
    spin();
  }
  if (e.key === 'Escape') togglePaytable(false);
});

showGrid();
if (!TOKEN) setMsg('This game needs a launch session. Open it from the casino.', 'err');
