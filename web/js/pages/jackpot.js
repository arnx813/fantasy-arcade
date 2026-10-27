// Jackpot: one shared pot, one winner drawn weighted by stake. Big pot ring, entry
// panel, players with their chance, and a history of rounds anyone can verify.
import { h, clear, toast, ICONS } from '../ui.js';
import { usd, toUnits } from '../format.js';
import { serverNow } from '../ws.js';
import { amountField } from '../betpanel.js';
import { useCss, winFx } from '../games/common.js';
import { createPotRing, playerColor } from '../arena/potring.js';
import { trackJackpot } from '../arena/feed.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
const pctText = (p) => (p >= 0.9995 ? '100%' : `${(p * 100).toFixed(p < 0.1 ? 2 : 1)}%`);
const nameEl = (user, cls = '') => (user ? h('a', { href: `/u/${user}`, class: `player-link ${cls}` }, user) : h('span', { class: `faint ${cls}` }, 'Hidden'));
const short = (s) => (s ? `${s.slice(0, 10)}…${s.slice(-6)}` : '—');

export async function render(page, _p, ctx) {
  useCss('arena');
  page.classList.add('page-arena');
  const cfg = ctx.store.get('config') || {};
  const rake = cfg.jackpotRake ?? 0.03;
  const minBet = cfg.pvpMinBet ?? 100000;
  const meId = () => ctx.store.get('me')?.id;

  // ---------- header stats ----------
  const stat = (k, cls = '') => {
    const v = h('div', { class: 'v' }, '—');
    return { el: h('div', { class: `jp-stat ${cls}` }, h('div', { class: 'k' }, k), v), v };
  };
  const sPot = stat('Pot', 'pot'), sPlayers = stat('Players'), sChance = stat('Your chance'), sTimer = stat('Draw', 'timer');
  const statusLine = h('p', { class: 'jp-status', 'aria-live': 'polite' }, 'Loading the current round');
  const head = h('header', { class: 'jp-head' },
    h('div', { class: 'jp-title' },
      h('div', { class: 'arena-kicker' }, h('span', { class: 'live-dot' }), 'Player vs player'),
      h('h1', 'Jackpot'),
      statusLine),
    h('div', { class: 'jp-stats' }, sPot.el, sPlayers.el, sChance.el, sTimer.el));

  // ---------- ring ----------
  const stage = h('div', { class: 'jp-stage' });
  const ring = createPotRing(stage, { size: 460 });
  const banner = h('div', { class: 'jp-banner hidden', role: 'status' });
  stage.append(banner);

  // ---------- entry panel ----------
  const amount = amountField(Number(localStorage.getItem('fa:jpBet') || 1));
  amount.input.min = String(minBet / 1e6);
  amount.input.addEventListener('change', () => { try { localStorage.setItem('fa:jpBet', amount.input.value); } catch {} });
  const quick = h('div', { class: 'jp-quick' }, [1, 5, 25].map((v) =>
    h('button', { type: 'button', class: 'btn', onClick: () => amount.set(Number(amount.input.value || 0) + v) }, `+$${v}`)));
  const joinBtn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button' }, 'Join pot');
  const preview = h('p', { class: 'small muted jp-preview' });
  const panel = h('section', { class: 'panel jp-entry', 'aria-label': 'Enter the pot' },
    h('h2', { class: 'arena-h' }, 'Your entry'),
    amount.el, quick, joinBtn, preview,
    h('p', { class: 'small faint' }, `Winner takes the pot minus a ${+(rake * 100).toFixed(2)}% house cut. Minimum entry ${usd(minBet)}. You can add to your stake until the draw.`));

  // ---------- players ----------
  const playersBody = h('div', { class: 'jp-players' });
  const playersPanel = h('section', { class: 'panel jp-players-panel' },
    h('div', { class: 'arena-head' }, h('h2', { class: 'arena-h' }, 'In this round'), h('span', { class: 'small muted jp-pcount' })),
    playersBody);

  // ---------- fairness + history ----------
  const seedBox = h('div', { class: 'jp-seed small' });
  const histBody = h('div', { class: 'jp-history' });
  const histPanel = h('section', { class: 'panel jp-history-panel' },
    h('div', { class: 'arena-head' }, h('h2', { class: 'arena-h' }, 'Recent rounds'), h('a', { href: '/fairness', class: 'small muted' }, 'How fairness works')),
    seedBox, histBody);

  page.append(head,
    h('div', { class: 'jp-grid' }, stage, h('div', { class: 'jp-side' }, panel, playersPanel)),
    histPanel);

  // ---------- state ----------
  let round = null, busy = false, spinning = false, announced = null, raf = 0;
  const myStake = (r = round) => (r?.players || []).filter((p) => p.userId === meId()).reduce((a, p) => a + p.amount, 0);
  const canEnter = () => round && ['open', 'countdown'].includes(round.status) && !spinning;

  function renderRound() {
    const r = round;
    const mine = myStake();
    sPot.v.textContent = usd(r?.pot || 0);
    sPlayers.v.textContent = String(r?.players?.length || 0);
    sChance.v.textContent = mine && r.pot ? pctText(mine / r.pot) : '—';
    sChance.el.classList.toggle('has', !!mine);
    joinBtn.textContent = !ctx.store.get('me') ? 'Sign in to join' : mine ? 'Add to pot' : 'Join pot';
    joinBtn.disabled = busy || (!!ctx.store.get('me') && !canEnter());
    seedBox.replaceChildren();
    if (r) clear(seedBox, h('span', { class: 'faint' }, `Round ${r.id} seed hash `), h('code', { class: 'jp-hash', title: r.seedHash }, r.seedHash));
    renderPreview();
    renderPlayers();
    paintTimer();
  }

  function renderPreview() {
    if (!round || !ctx.store.get('me')) { preview.textContent = ''; return; }
    const add = amount.units;
    const mine = myStake() + add;
    const pot = round.pot + add;
    preview.textContent = add >= minBet && canEnter()
      ? `With ${usd(add)} more your chance is ${pctText(mine / pot)} to win about ${usd(Math.floor(pot * (1 - rake)))}.`
      : '';
  }
  amount.input.addEventListener('input', renderPreview);

  function renderPlayers() {
    const ps = [...(round?.players || [])].sort((a, b) => b.amount - a.amount);
    const pot = round?.pot || 0;
    page.querySelector('.jp-pcount').textContent = ps.length ? `${ps.length} ${ps.length === 1 ? 'player' : 'players'} · ${usd(pot)}` : '';
    const won = round?.result?.winnerId;
    clear(playersBody, ps.length ? ps.map((p) => h('div', { class: `jp-player ${p.userId === meId() ? 'me' : ''} ${won && !spinning ? (p.userId === won ? 'won' : 'lost') : ''}` },
      h('span', { class: 'swatch', style: { background: playerColor(p.userId) } }),
      h('span', { class: 'who' }, nameEl(p.user), p.userId === meId() ? h('span', { class: 'you-tag' }, 'You') : null),
      h('span', { class: 'stake' }, usd(p.amount)),
      h('span', { class: 'chance' }, pctText(pot ? p.amount / pot : 0)),
      h('span', { class: 'bar', style: { '--w': `${pot ? (p.amount / pot) * 100 : 0}%`, '--c': playerColor(p.userId) } })))
      : h('p', { class: 'muted jp-empty' }, 'Nobody is in yet. The first entry sets the table.'));
  }

  function statusText() {
    const r = round;
    if (!r) return 'Loading the current round';
    if (spinning) return 'Drawing the winner';
    if (r.status === 'open') return r.players.length ? 'Waiting for a second player' : 'Waiting for players. Be the first in';
    if (r.status === 'countdown') return `Drawing in ${Math.max(0, Math.ceil((r.endsAt - serverNow()) / 1000))}s`;
    if (r.status === 'drawing') return 'Drawing the winner';
    return 'Round over. The next one opens in a moment';
  }
  function paintTimer() {
    const r = round;
    statusLine.textContent = statusText();
    if (r?.status === 'countdown' && !spinning) {
      const left = Math.max(0, r.endsAt - serverNow());
      sTimer.v.textContent = `${Math.floor(left / 1000)}.${Math.floor((left % 1000) / 100)}s`;
      sTimer.el.classList.toggle('urgent', left < 5000);
    } else {
      sTimer.v.textContent = r?.status === 'open' ? 'Waiting' : !r ? '—' : r.result && !spinning ? 'Done' : 'Now';
      sTimer.el.classList.remove('urgent');
    }
  }
  const loop = () => { paintTimer(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  // ---------- entering ----------
  joinBtn.addEventListener('click', async () => {
    if (!ctx.requireAuth()) return;
    const units = amount.units;
    if (units < minBet) return toast(`Minimum entry is ${usd(minBet)}`, 'error');
    if (units > ctx.store.get('balance')) return toast('Not enough balance for that entry', 'error');
    busy = true; joinBtn.disabled = true;
    const r = await ctx.attempt(() => ctx.api.post('/api/arena/jackpot/enter', { amount: units }));
    busy = false;
    if (r) {
      if (!ctx.store.get('balanceHold')) ctx.store.set('balance', r.balance);
      toast(`You put ${usd(units)} in the pot`, 'success', 2200);
    }
    renderRound();
  });

  // ---------- history ----------
  function verifyBox(id) {
    const box = h('div', { class: 'jp-verify' }, h('p', { class: 'small muted' }, 'Loading the round'));
    ctx.api.get(`/api/arena/jackpot/rounds/${id}`).then(async (d) => {
      if (!d.serverSeed) { clear(box, h('p', { class: 'small muted' }, 'This round has not been revealed yet.')); return; }
      const hashOk = (await sha256(d.serverSeed)) === d.seedHash;
      const digest = await sha256(JSON.stringify(d.entries.map((e) => [e.userId, e.amount])));
      const digestOk = digest === d.digest;
      const hx = await hmacHex(d.serverSeed, `${d.id}:${d.digest}`);
      const ticket = Math.floor((parseInt(hx.slice(0, 13), 16) / 2 ** 52) * d.pot);
      let acc = 0, winner = d.entries[d.entries.length - 1];
      for (const e of d.entries) { acc += e.amount; if (ticket < acc) { winner = e; break; } }
      const ticketOk = ticket === d.ticket;
      const row = (k, v, ok) => h('div', { class: 'jp-vrow' }, h('span', { class: 'k' }, k), h('code', v),
        ok === undefined ? h('span') : h('span', { class: ok ? 'ok' : 'bad' }, ok ? 'Matches' : 'Mismatch'));
      clear(box,
        row('Seed hash', d.seedHash), row('Server seed', d.serverSeed, hashOk), row('Entries digest', d.digest, digestOk),
        row('Ticket', `${d.ticket.toLocaleString('en-US')} of ${d.pot.toLocaleString('en-US')}`, ticketOk),
        row('Winning entry', `${winner.user || 'Hidden'} · ${usd(winner.amount)}`),
        h('p', { class: 'small muted' },
          'To recompute: SHA-256 of the server seed must equal the hash shown before the round. The digest is SHA-256 of the entries as JSON pairs [userId, amount] in entry order. ',
          `The ticket is the first 13 hex digits of HMAC-SHA256(key = server seed, message = "${d.id}:digest") divided by 2^52, times the pot in micro-dollars, rounded down. `,
          'Lay the entries end to end in order; the entry whose range holds the ticket wins. Your browser just did this and got the results marked above.'));
    }).catch(() => clear(box, h('p', { class: 'small loss' }, 'Could not load this round.')));
    return box;
  }
  const open = new Set();
  function renderHistory(list) {
    clear(histBody, list?.length ? h('div', { class: 'jp-hlist' }, list.map((x) => {
      const holder = h('div', { class: 'jp-hverify' });
      const toggle = h('button', { type: 'button', class: 'btn btn-glass jp-vbtn', 'aria-expanded': 'false', html: `${ICONS.shield}<span>Verify</span>` });
      const show = () => { toggle.setAttribute('aria-expanded', 'true'); toggle.classList.add('on'); clear(holder, verifyBox(x.id)); };
      toggle.addEventListener('click', () => {
        if (open.has(x.id)) { open.delete(x.id); toggle.setAttribute('aria-expanded', 'false'); toggle.classList.remove('on'); clear(holder); }
        else { open.add(x.id); show(); }
      });
      if (open.has(x.id)) show();
      return h('div', { class: 'jp-hitem' },
        h('div', { class: 'jp-hrow' },
          h('span', { class: 'rid faint' }, `#${x.id}`),
          h('span', { class: 'who' }, h('span', { class: 'crown', html: ICONS.crown }), nameEl(x.winner)),
          h('span', { class: 'pot' }, h('span', { class: 'faint small' }, 'Pot '), usd(x.pot)),
          h('span', { class: 'chance' }, x.chance != null ? h('span', { class: x.chance < 0.25 ? 'lucky' : '' }, pctText(x.chance)) : h('span', { class: 'faint' }, '—')),
          h('span', { class: 'won win' }, `+${usd(x.payout ?? 0)}`),
          toggle),
        holder);
    })) : h('p', { class: 'muted' }, 'No finished rounds yet.'));
  }

  // ---------- draw ----------
  function announce(r) {
    if (announced === r.id) return;
    announced = r.id;
    const res = r.result;
    const mine = myStake(r);
    const isMe = res.winnerId === meId();
    banner.className = `jp-banner ${isMe ? 'me' : ''}`;
    clear(banner,
      h('span', { class: 'swatch', style: { background: playerColor(res.winnerId) } }),
      h('span', isMe ? 'You win ' : [res.winner || 'A hidden player', ' wins ']), h('strong', usd(res.payout)),
      h('span', { class: 'faint' }, ` with a ${pctText(res.chance)} chance`),
      !isMe && mine ? h('span', { class: 'muted' }, '. Not this time.') : null);
    if (isMe && mine) winFx(res.payout / mine, res.payout);
  }

  const feed = trackJackpot(ctx, {
    onRound(r, { fresh } = {}) {
      if (spinning && r.id === round?.id) return;
      if (fresh || r.id !== round?.id) { banner.classList.add('hidden'); }
      round = r;
      ring.update(r, meId());
      renderRound();
    },
    async onDraw(r, spinMs, { late, ended } = {}) {
      round = r;
      if (ended) { ring.showLanded(r); renderRound(); announce(r); return; }
      spinning = true;
      banner.classList.add('hidden');
      ring.update(r, meId());
      renderRound();
      await ring.spinTo(r, late ? Math.min(spinMs, 1400) : Math.max(1500, spinMs - 400));
      spinning = false;
      feed.release();
      renderRound();
      announce(r);
    },
    onHistory: renderHistory,
  });
  const offMe = ctx.store.on('me', renderRound);
  const offBal = ctx.store.on('balance', renderPreview);
  renderRound();

  return () => { cancelAnimationFrame(raf); feed.stop(); ring.destroy(); offMe(); offBal(); };
}
