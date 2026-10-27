// App shell: sidebar, top bar with balance + wallet, chat drawer, and a path router.
import { h, clear, toast, modal, ICONS, copyText } from './ui.js';
import { api, attempt } from './api.js';
import { store } from './store.js';
import { connectWs, reconnectWs, onWs, sendWs } from './ws.js';
import { usd, toUnits, ago } from './format.js';

// ---------- routes ----------
const ROUTES = [
  [/^\/(casino)?\/?$/, () => import('./pages/lobby.js')],
  [/^\/casino\/(?<game>[a-z]+)$/, () => import('./pages/game.js')],
  [/^\/slots$/, () => import('./pages/slots.js')],
  [/^\/play\/(?<gameId>[^/]+)$/, () => import('./pages/play.js')],
  [/^\/vip$/, () => import('./pages/vip.js')],
  [/^\/affiliate$/, () => import('./pages/affiliate.js')],
  [/^\/fairness$/, () => import('./pages/fairness.js')],
  [/^\/bets$/, () => import('./pages/bets.js')],
  [/^\/settings$/, () => import('./pages/settings.js')],
  [/^\/admin$/, () => import('./pages/admin.js')],
];

let cleanup = null;
const main = h('main', { class: 'main', id: 'main' });

export function navigate(path, replace = false) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  route();
}

async function route() {
  const path = location.pathname;
  const hit = ROUTES.find(([re]) => re.test(path));
  cleanup?.();
  cleanup = null;
  document.querySelector('.sidebar')?.classList.remove('open');
  highlightNav(path);
  if (!hit) {
    clear(main, h('div', { class: 'page' }, h('h1', 'Nothing here'), h('p', { class: 'muted', style: { marginTop: '12px' } }, 'That page does not exist. ', h('a', { href: '/' }, 'Back to the lobby'))));
    return;
  }
  const params = path.match(hit[0]).groups || {};
  const mod = await hit[1]();
  const page = h('div', { class: 'page' });
  clear(main, page);
  main.scrollTop = 0;
  cleanup = (await mod.render(page, params, ctx)) || null;
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.origin !== location.origin || e.metaKey || e.ctrlKey || a.hasAttribute('download')) return;
  if (a.pathname.startsWith('/api/') || a.pathname.startsWith('/provider-demo/')) return;
  e.preventDefault();
  navigate(a.pathname + a.search);
});
window.addEventListener('popstate', route);

// ---------- session ----------
async function loadMe() {
  try {
    const me = await api.get('/api/me');
    store.set('me', me);
    store.set('balance', me.balance);
  } catch {
    store.set('me', null);
    store.set('balance', 0);
  }
}
export const refreshMe = loadMe;

export function requireAuth() {
  if (store.get('me')) return true;
  openAuth('register');
  return false;
}

function openAuth(mode = 'login') {
  const form = h('form', { class: 'stack' });
  const m = modal(mode === 'login' ? 'Sign in' : 'Create account', form);
  const render = () => {
    const ref = new URLSearchParams(location.search).get('r') || localStorage.getItem('fa:ref') || '';
    clear(form,
      mode === 'register' ? h('label', { class: 'field' }, 'Username', h('input', { class: 'input', name: 'username', autocomplete: 'username', required: true, minLength: 3, maxLength: 16 })) : null,
      h('label', { class: 'field' }, mode === 'login' ? 'Username or email' : 'Email',
        h('input', { class: 'input', name: mode === 'login' ? 'login' : 'email', type: mode === 'login' ? 'text' : 'email', autocomplete: mode === 'login' ? 'username' : 'email', required: true })),
      h('label', { class: 'field' }, 'Password', h('input', { class: 'input', name: 'password', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true, minLength: 8 })),
      mode === 'register' ? h('label', { class: 'field' }, 'Referral code (optional)', h('input', { class: 'input', name: 'referral', value: ref })) : null,
      mode === 'register' ? h('p', { class: 'small muted' }, 'By creating an account you confirm you are of legal gambling age where you live and accept the terms.') : null,
      h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, mode === 'login' ? 'Sign in' : 'Create account'),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => { mode = mode === 'login' ? 'register' : 'login'; m.el.querySelector('h2').textContent = mode === 'login' ? 'Sign in' : 'Create account'; render(); } },
        mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'));
    form.querySelector('input')?.focus();
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    const me = await attempt(() => api.post(mode === 'login' ? '/api/auth/login' : '/api/auth/register', body));
    if (!me) return;
    store.set('me', me);
    store.set('balance', me.balance);
    reconnectWs();
    m.close();
    toast(mode === 'login' ? `Welcome back, ${me.username}` : `Welcome to Fantasy Arcade, ${me.username}`, 'success');
    route();
  });
  render();
}

async function logout() {
  await attempt(() => api.post('/api/auth/logout'));
  store.set('me', null);
  store.set('balance', 0);
  reconnectWs();
  navigate('/');
}

// ---------- wallet ----------
export async function openWallet(tab = 'deposit') {
  if (!requireAuth()) return;
  const [chains, cfg] = await Promise.all([api.get('/api/wallet/chains'), api.get('/api/config')]);
  const body = h('div', { class: 'stack' });
  modal('Wallet', body);
  const tabs = h('div', { class: 'tabs' });
  const content = h('div', { class: 'stack' });
  clear(body, tabs, content);
  const setTab = (t) => {
    tab = t;
    clear(tabs, ...['deposit', 'withdraw', 'history'].map((k) => h('button', { class: k === t ? 'on' : '', onClick: () => setTab(k) }, k[0].toUpperCase() + k.slice(1))));
    ({ deposit, withdraw, history: hist })[t]();
  };
  const chainSelect = () => h('select', { class: 'input' }, chains.map((c) => h('option', { value: c.id }, `${c.asset} · ${c.name}`)));
  async function deposit() {
    const sel = chainSelect();
    const box = h('div', { class: 'stack' });
    const load = async () => {
      const a = await attempt(() => api.get(`/api/wallet/deposit-address?chain=${encodeURIComponent(sel.value)}`));
      const chain = chains.find((c) => c.id === sel.value);
      clear(box, a ? [
        h('div', { class: 'field' }, h('span', { class: 'small muted' }, `Your ${chain.asset} deposit address (${chain.name})`),
          h('div', { class: 'address-box row' }, h('span', { class: 'grow' }, a.address), h('button', { class: 'icon-btn', 'aria-label': 'Copy address', onClick: () => copyText(a.address), html: ICONS.copy }))),
        h('p', { class: 'small muted' }, `Send only ${chain.asset} on ${chain.name}. Credited in USD after ${chain.confirmations} confirmations.`),
      ] : h('p', { class: 'muted' }, 'Deposits are unavailable right now.'));
    };
    sel.addEventListener('change', load);
    const mock = cfg.mockPayments ? h('div', { class: 'notice stack' },
      h('span', 'Development mode: simulate a confirmed deposit to this address.'),
      h('div', { class: 'row' }, ...[25, 100, 1000].map((v) => h('button', { class: 'btn', onClick: async () => {
        const r = await attempt(() => api.post('/api/dev/mock-deposit', { usd: v, chain: sel.value }));
        if (r) toast(`Deposited ${usd(toUnits(v))}`, 'success');
      } }, `+$${v}`)))) : null;
    clear(content, h('label', { class: 'field' }, 'Currency', sel), box, mock);
    load();
  }
  function withdraw() {
    const sel = chainSelect();
    const amt = h('input', { class: 'input', type: 'number', min: '0', step: '0.01', placeholder: '0.00' });
    const addr = h('input', { class: 'input', placeholder: 'Destination address', autocomplete: 'off' });
    const me = store.get('me');
    clear(content,
      h('label', { class: 'field' }, 'Currency', sel),
      h('label', { class: 'field' }, h('div', { class: 'field-row' }, h('span', 'Amount (USD)'), h('span', { class: 'faint' }, `Available ${usd(store.get('balance'))}`)),
        h('div', { class: 'input-group' }, h('span', { class: 'addon' }, '$'), amt, h('button', { type: 'button', onClick: () => (amt.value = (store.get('balance') / 1e6).toFixed(2)) }, 'Max'))),
      h('label', { class: 'field' }, 'Address', addr),
      h('p', { class: 'small muted' }, `Minimum ${usd(cfg.minWithdrawal)}. Withdrawals are reviewed and usually sent within an hour. ${me.kycStatus !== 'verified' ? 'Large withdrawals need identity verification.' : ''}`),
      h('button', { class: 'btn btn-primary btn-lg', onClick: async () => {
        const r = await attempt(() => api.post('/api/wallet/withdraw', { amount: toUnits(amt.value), chain: sel.value, address: addr.value }));
        if (r) { toast('Withdrawal requested', 'success'); setTab('history'); }
      } }, 'Request withdrawal'));
  }
  async function hist() {
    const r = await attempt(() => api.get('/api/wallet/history'));
    if (!r) return;
    const rows = [...r.deposits.map((d) => ({ ...d, type: 'Deposit' })), ...r.withdrawals.map((w) => ({ ...w, type: 'Withdrawal' }))].sort((a, b) => b.created_at - a.created_at);
    clear(content, rows.length ? h('table', { class: 'data' },
      h('tr', h('th', 'Type'), h('th', 'Currency'), h('th', { class: 'num' }, 'Amount'), h('th', 'Status'), h('th', 'When')),
      rows.map((x) => h('tr', h('td', x.type), h('td', x.chain), h('td', { class: 'num' }, usd(x.amount)), h('td', x.status), h('td', { class: 'faint' }, ago(x.created_at))))) :
      h('p', { class: 'muted' }, 'No deposits or withdrawals yet.'));
  }
  setTab(tab);
}

// ---------- chat ----------
function buildChat() {
  const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  const input = h('input', { class: 'input', placeholder: 'Say something', maxLength: 200, 'aria-label': 'Chat message' });
  const online = h('span', { class: 'small muted' });
  const el = h('aside', { class: `chat ${store.get('chatOpen') ? '' : 'closed'}`, 'aria-label': 'Chat' },
    h('div', { class: 'chat-head' }, h('h3', { class: 'grow' }, 'Chat'), h('span', { class: 'online-dot' }), online,
      h('button', { class: 'icon-btn', 'aria-label': 'Close chat', html: ICONS.x, onClick: () => store.set('chatOpen', false) })),
    log,
    h('form', { class: 'chat-form', onSubmit: (e) => {
      e.preventDefault();
      if (!requireAuth()) return;
      if (input.value.trim()) sendWs({ t: 'chat', text: input.value });
      input.value = '';
    } }, input));
  const add = (m) => {
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    log.append(h('div', { class: 'chat-msg', 'data-id': m.id },
      h('span', { class: 'tier' }, m.vip), h('span', { class: 'who', style: { color: m.admin ? 'var(--marquee)' : '' } }, m.user), h('span', m.text)));
    while (log.children.length > 100) log.firstChild.remove();
    if (stick) log.scrollTop = log.scrollHeight;
  };
  onWs('hello', (m) => { clear(log); m.chat.forEach(add); });
  onWs('chat', (m) => add(m.msg));
  onWs('chat:delete', (m) => log.querySelector(`[data-id="${m.id}"]`)?.remove());
  onWs('chat:error', (m) => toast(m.error, 'error'));
  store.on('chatOpen', (o) => el.classList.toggle('closed', !o));
  setInterval(async () => { try { online.textContent = `${(await api.get('/api/public/stats')).online} online`; } catch {} }, 30000);
  // First count after the socket has connected, so it includes this visitor.
  setTimeout(() => api.get('/api/public/stats').then((s) => (online.textContent = `${s.online} online`)).catch(() => {}), 1500);
  return el;
}

// ---------- shell ----------
const NAV = [
  [null, [['/', 'Lobby', ICONS.home], ['/slots', 'Slots', ICONS.reels]]],
  ['Originals', [['/casino/crash', 'Crash'], ['/casino/mines', 'Mines'], ['/casino/plinko', 'Plinko'], ['/casino/dice', 'Dice'], ['/casino/limbo', 'Limbo'],
    ['/casino/blackjack', 'Blackjack'], ['/casino/hilo', 'HiLo'], ['/casino/keno', 'Keno'], ['/casino/tower', 'Tower'], ['/casino/wheel', 'Wheel'],
    ['/casino/roulette', 'Roulette'], ['/casino/baccarat', 'Baccarat'], ['/casino/videopoker', 'Video Poker'], ['/casino/coinflip', 'Coinflip']]],
  ['You', [['/vip', 'VIP & rakeback', ICONS.crown], ['/affiliate', 'Refer friends', ICONS.users], ['/bets', 'My bets', ICONS.history], ['/fairness', 'Fairness', ICONS.shield], ['/settings', 'Settings & limits', ICONS.gear]]],
];
function highlightNav(path) {
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === path || (path === '/casino' && a.getAttribute('href') === '/')));
}
const DOT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.5"/></svg>';

function shell() {
  const navEl = h('nav', { class: 'nav', 'aria-label': 'Main' });
  const renderNav = () => clear(navEl, NAV.map(([group, links]) => [
    group ? h('div', { class: 'nav-group' }, group) : null,
    links.map(([href, label, icon]) => h('a', { href, html: (icon || DOT) + `<span>${label}</span>` })),
  ]), store.get('me') ? h('a', { href: '#', class: 'mobile-only', html: ICONS.lock + '<span>Sign out</span>', onClick: (e) => { e.preventDefault(); logout(); } }) : null,
  store.get('me')?.role === 'admin' ? [h('div', { class: 'nav-group' }, 'Operator'), h('a', { href: '/admin', html: ICONS.chart + '<span>Admin</span>' })] : null);
  const sidebar = h('aside', { class: 'sidebar' },
    h('a', { class: 'brand', href: '/', 'aria-label': 'Fantasy Arcade home', html:
      `<svg class="brand-mark" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#22222a"/><path d="M18 14h28l-6 10H30l-3 6h11l-5 9h-10l-6 11h-7z" fill="#ffb320"/><circle cx="46" cy="44" r="6" fill="#45e0a8"/></svg>
       <div class="brand-word">Fantasy<span>Arcade</span></div>` }),
    navEl);

  const bal = h('div', { class: 'bal' });
  const walletPill = h('div', { class: 'wallet-pill', style: { marginLeft: 'auto' } }, bal, h('button', { class: 'btn btn-primary', style: { borderRadius: 0 }, onClick: () => openWallet() }, 'Wallet'));
  const right = h('div', { class: 'row', style: { marginLeft: 'auto' } });
  const top = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn mobile-only', 'aria-label': 'Menu', html: ICONS.menu, onClick: () => sidebar.classList.toggle('open') }),
    walletPill, right);
  const renderTop = () => {
    const me = store.get('me');
    walletPill.classList.toggle('hidden', !me);
    clear(right,
      me ? [
        h('a', { href: '/vip', class: 'btn btn-ghost desktop-only', title: 'VIP progress' }, me.username),
        h('button', { class: 'btn btn-ghost desktop-only', onClick: logout }, 'Sign out'),
      ] : [
        h('button', { class: 'btn btn-ghost desktop-only', onClick: () => openAuth('login') }, 'Sign in'),
        h('button', { class: 'btn btn-primary', onClick: () => openAuth('register') }, 'Create account'),
      ],
    );
  };
  store.on('balance', (b) => {
    const prev = Number(bal.dataset.v || 0);
    bal.textContent = usd(b);
    bal.dataset.v = b;
    if (b > prev) { bal.classList.remove('bump'); void bal.offsetWidth; bal.classList.add('bump'); }
  });
  store.on('me', () => { renderTop(); renderNav(); });
  bal.textContent = usd(store.get('balance'));
  bal.dataset.v = store.get('balance');
  renderTop();
  renderNav();
  // Chat opens from a floating button that steps aside while the drawer is open.
  const fab = h('button', { class: `chat-fab ${store.get('chatOpen') ? 'hidden-by-chat' : ''}`, 'aria-label': 'Open chat', html: ICONS.chat, onClick: () => store.set('chatOpen', true) });
  store.on('chatOpen', (o) => fab.classList.toggle('hidden-by-chat', o));
  return h('div', { class: 'shell' }, sidebar, top, main, buildChat(), fab);
}

// Context handed to every page.
const ctx = { api, attempt, store, navigate, requireAuth, openWallet, refreshMe };

async function boot() {
  const ref = new URLSearchParams(location.search).get('r');
  if (ref) try { localStorage.setItem('fa:ref', ref); } catch {}
  store.set('config', await api.get('/api/config'));
  await loadMe();
  document.getElementById('app').append(shell());
  // Games that animate a result (Plinko, Wheel) set balanceHold so the push cannot
  // reveal a win before the ball lands; they apply the settled balance themselves.
  onWs('balance', (m) => { if (!store.get('balanceHold')) store.set('balance', m.balance); });
  onWs('deposit', (m) => toast(`Deposit of ${usd(m.amount)} credited`, 'success'));
  onWs('withdrawal', (m) => toast(`Withdrawal #${m.id} ${m.status}`, 'success'));
  connectWs();
  route();
}
boot();
