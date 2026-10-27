// Crash: one shared round, driven by the websocket. Betting (countdown) -> running
// (the multiplier climbs; cash out any time) -> ended (crashed at X). The curve is
// computed locally from the shared growth function and the server's start time.
import { h, clear } from '../ui.js';
import { amountField } from '../betpanel.js';
import { usd, mult } from '../format.js';
import { onWs, serverNow } from '../ws.js';
import { useCss } from './common.js';
import { crashMultiplierAt, crashTimeFor, CRASH_GROWTH } from '/shared/crash.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const BETTING_MS = 7000; // server default; only used to scale the countdown bar

export function mount({ controls, stage, foot, ctx }) {
  useCss('crash');
  let round = null;       // public round: { id, phase, bettingEndsAt, startedAt, crashPoint, bets[] }
  let history = [];
  let mine = null;        // { id, roundId, amount, auto, cashedOutAt, payout }
  let queued = null;      // { amount, auto } waiting for the next betting phase
  let busy = false, raf = 0, lastLabel = '';

  // ---------- controls ----------
  const amount = amountField(Number(localStorage.getItem('fa:lastBet') || 1));
  amount.input.addEventListener('change', () => { try { localStorage.setItem('fa:lastBet', amount.input.value); } catch {} });
  const autoIn = h('input', { class: 'input', type: 'number', min: '1.01', step: '0.01', placeholder: 'Off', inputMode: 'decimal', 'aria-label': 'Auto cash-out multiplier' });
  try { autoIn.value = localStorage.getItem('fa:crashAuto') || ''; } catch {}
  autoIn.addEventListener('change', () => { try { localStorage.setItem('fa:crashAuto', autoIn.value); } catch {} });
  const autoField = h('label', { class: 'field' },
    h('div', { class: 'field-row' }, h('span', 'Auto cash-out'), h('span', { class: 'faint' }, 'Optional')),
    h('div', { class: 'input-group' }, autoIn, h('span', { class: 'addon' }, '×')));
  const button = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button' }, 'Bet');
  const note = h('div', { class: 'crash-note small muted', 'aria-live': 'polite' });
  controls.append(amount.el, autoField, button, note);

  // ---------- stage ----------
  const canvas = h('canvas', { class: 'crash-canvas', 'aria-hidden': 'true' });
  const readout = h('div', { class: 'crash-readout' });
  const sub = h('div', { class: 'crash-sub' });
  const bar = h('div', { class: 'crash-bar' }, h('div'));
  const graph = h('div', { class: 'crash-graph' }, canvas, h('div', { class: 'crash-hud', role: 'status' }, readout, sub, bar));
  const playersHead = h('div', { class: 'crash-players-head' }, h('span', 'Players'), h('span', { class: 'faint' }));
  const playersList = h('div', { class: 'crash-players-list' });
  const players = h('aside', { class: 'crash-players', 'aria-label': 'This round\'s players' }, playersHead, playersList);
  stage.append(h('div', { class: 'crash' }, graph, players));

  const histStrip = h('div', { class: 'history-strip crash-history', 'aria-label': 'Recent crash points' });
  foot.append(h('span', { class: 'small faint crash-hist-label' }, 'Recent'), histStrip);

  // ---------- state helpers ----------
  const me = () => ctx.store.get('me');
  const elapsed = () => Math.max(0, serverNow() - round.startedAt);
  const liveMult = () => (round?.phase === 'running' ? crashMultiplierAt(elapsed()) : 1);
  const activeMine = () => mine && round && mine.roundId === round.id && mine.cashedOutAt == null;
  const cashValue = (m) => Math.floor((mine.amount * Math.round(m * 100)) / 100);
  const readAuto = () => {
    const v = autoIn.value.trim();
    return v === '' ? null : Number(v);
  };

  function setRound(r, myBetId = null) {
    round = r ? { ...r, bets: [...(r.bets || [])] } : null;
    if (round && mine && mine.roundId !== round.id) mine = null;
    // After a refresh, recover our own bet: the server tells us its id (works for
    // hidden players too); fall back to matching the username.
    if (round && !mine && me()) {
      const b = round.bets.find((x) => (myBetId && x.id === myBetId) || (x.user && x.user === me().username));
      if (b) mine = { id: b.id, roundId: round.id, amount: b.amount, auto: null, cashedOutAt: b.cashedOutAt, payout: b.payout };
    }
    renderPlayers();
    paintButton();
  }
  function upsertBet(bet) {
    if (!round) return;
    const i = round.bets.findIndex((b) => b.id === bet.id);
    if (i >= 0) round.bets[i] = bet; else round.bets.push(bet);
    if (mine && bet.id === mine.id) { mine.cashedOutAt = bet.cashedOutAt; mine.payout = bet.payout; }
    renderPlayers();
    paintButton();
  }

  // ---------- actions ----------
  async function placeNow(spec) {
    if (busy) return;
    busy = true;
    paintButton();
    const roundId = round?.id;
    const r = await ctx.attempt(() => ctx.api.post('/api/crash/bet', { amount: spec.amount, autoCashout: spec.auto }));
    busy = false;
    if (r) {
      if (r.balance !== undefined) ctx.store.set('balance', r.balance);
      // The server may lower a requested auto cash-out to the max-profit cap.
      mine = { id: r.id, roundId: r.roundId ?? roundId, amount: r.amount, auto: spec.auto != null ? r.autoCashout : null, cashedOutAt: null, payout: null };
      // The bet broadcast may already have landed; reconcile in case it has.
      const pub = round?.bets.find((b) => b.id === r.id);
      if (pub) { mine.cashedOutAt = pub.cashedOutAt; mine.payout = pub.payout; }
      renderPlayers();
    }
    paintButton();
  }
  async function cashOut() {
    if (busy) return;
    busy = true;
    paintButton();
    const r = await ctx.attempt(() => ctx.api.post('/api/crash/cashout'));
    busy = false;
    if (r) {
      if (r.balance !== undefined) ctx.store.set('balance', r.balance);
      if (mine) { mine.cashedOutAt = r.cashedOutAt; mine.payout = r.payout; }
      renderPlayers();
    }
    paintButton();
  }
  button.addEventListener('click', () => {
    if (!ctx.requireAuth()) return;
    if (activeMine() && round.phase === 'running') return cashOut();
    if (queued) { queued = null; return paintButton(); }
    const auto = readAuto();
    if (auto !== null && !(auto >= 1.01)) return autoIn.focus();
    const spec = { amount: amount.units, auto };
    if (round?.phase === 'betting' && !(mine && mine.roundId === round.id)) return placeNow(spec);
    if (round?.phase !== 'betting') { queued = spec; paintButton(); }
  });

  // ---------- button + note ----------
  function paintButton() {
    const phase = round?.phase;
    let label, cls = 'btn-primary', disabled = busy;
    if (activeMine() && phase === 'running') {
      label = `Cash out ${usd(cashValue(liveMult()))}`;
      cls = 'btn-win';
    } else if (queued) {
      label = 'Cancel next-round bet';
      cls = 'btn-queued';
    } else if (phase === 'betting') {
      if (mine && mine.roundId === round.id) { label = 'Bet placed'; disabled = true; } else label = busy ? 'Placing bet' : 'Bet';
    } else {
      label = 'Bet next round';
    }
    const key = `${label}|${cls}|${disabled}`;
    if (key !== lastLabel) {
      lastLabel = key;
      button.textContent = label;
      button.className = `btn btn-lg btn-block ${cls}`;
      button.disabled = disabled;
    }
    paintNote();
  }
  let lastNote = '';
  function paintNote() {
    let t = '';
    if (queued) t = `Queued for the next round: ${usd(queued.amount)}${queued.auto ? `, auto cash-out at ${mult(queued.auto)}` : ''}.`;
    else if (mine && round && mine.roundId === round.id) {
      if (mine.cashedOutAt != null) t = `Cashed out at ${mult(mine.cashedOutAt)} for ${usd(mine.payout)}.`;
      else if (round.phase === 'ended') t = `Lost ${usd(mine.amount)} this round.`;
      else t = `In for ${usd(mine.amount)}${mine.auto ? `, auto cash-out at ${mult(mine.auto)}` : ''}.`;
    }
    if (t !== lastNote) { lastNote = t; note.textContent = t; }
    amount.disable(!!queued);
    autoIn.disabled = !!queued;
  }

  // ---------- players ----------
  function renderPlayers() {
    const bets = round ? [...round.bets].sort((a, b) => b.amount - a.amount) : [];
    const ended = round?.phase === 'ended';
    playersHead.lastChild.textContent = bets.length ? `${bets.length} · ${usd(bets.reduce((s, b) => s + b.amount, 0), { compact: true })}` : '';
    if (!bets.length) {
      clear(playersList, h('div', { class: 'crash-empty faint small' }, round?.phase === 'betting' ? 'No bets yet. Be the first in.' : 'No bets this round.'));
      return;
    }
    clear(playersList, bets.map((b) => {
      const cashed = b.cashedOutAt != null;
      const isMine = mine && b.id === mine.id;
      const state = cashed ? 'w' : ended ? 'l' : '';
      return h('div', { class: `crash-player ${state} ${isMine ? 'me' : ''}` },
        h('span', { class: 'who' }, b.user ?? 'Hidden'),
        h('span', { class: 'amt' }, usd(b.amount, { compact: true })),
        h('span', { class: 'res' }, cashed ? [h('b', mult(b.cashedOutAt)), ' ', usd(b.payout - b.amount, { sign: true, compact: true })] : ended ? usd(-b.amount, { compact: true }) : '—'));
    }));
  }

  // ---------- history ----------
  function renderHistory() {
    clear(histStrip, history.slice(0, 16).map((x) => h('span', { class: `result-chip ${x.crashPoint >= 2 ? 'w' : ''}`, title: `Round ${x.id}` }, mult(x.crashPoint))));
  }

  // ---------- drawing ----------
  const g = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  function resize() {
    const r = graph.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(graph);

  // Pick a tidy gridline step for a range.
  function niceStep(range, target) {
    const raw = range / target;
    const p = 10 ** Math.floor(Math.log10(raw));
    const n = raw / p;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
  }

  function drawGraph(tMs, m, crashed) {
    if (!W || !H) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const padL = 46, padR = 18, padT = 18, padB = 28;
    const pw = W - padL - padR, ph = H - padT - padB;
    const xMax = Math.max(8000, tMs * 1.12);
    const yMax = Math.max(2, 1 + (m - 1) * 1.18);
    const X = (t) => padL + (t / xMax) * pw;
    const Y = (v) => padT + ph - ((v - 1) / (yMax - 1)) * ph;

    // grid
    g.font = '600 11px Chivo, system-ui, sans-serif';
    g.lineWidth = 1;
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    const ys = niceStep(yMax - 1, 4);
    for (let v = 1; v <= yMax + 1e-9; v += ys) {
      const y = Math.round(Y(v)) + 0.5;
      g.strokeStyle = 'rgba(169,158,198,0.12)';
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.fillStyle = '#6d6d7c';
      g.fillText(`${+v.toFixed(2)}×`, padL - 8, y);
    }
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const xs = niceStep(xMax / 1000, 5) * 1000;
    for (let t = 0; t <= xMax; t += xs) {
      g.fillStyle = '#6d6d7c';
      g.fillText(`${Math.round(t / 1000)}s`, X(t), H - padB + 8);
    }
    g.strokeStyle = 'rgba(169,158,198,0.3)';
    g.beginPath(); g.moveTo(padL + 0.5, padT); g.lineTo(padL + 0.5, H - padB + 0.5); g.lineTo(W - padR, H - padB + 0.5); g.stroke();
    if (tMs <= 0) return;

    // curve: exp growth, clamped to the shown multiplier at the tip
    const col = crashed ? '#ff5d73' : '#ffb320';
    const steps = Math.max(24, Math.min(160, Math.round(pw / 4)));
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = (tMs * i) / steps;
      const v = Math.min(m, Math.exp(CRASH_GROWTH * t));
      if (i === 0) g.moveTo(X(t), Y(v)); else g.lineTo(X(t), Y(v));
    }
    const tipX = X(tMs), tipY = Y(m);
    // area fill
    g.save();
    g.lineTo(tipX, Y(1)); g.lineTo(X(0), Y(1)); g.closePath();
    const grad = g.createLinearGradient(0, tipY, 0, Y(1));
    grad.addColorStop(0, crashed ? 'rgba(255,93,115,0.28)' : 'rgba(255,179,32,0.28)');
    grad.addColorStop(1, 'rgba(255,179,32,0)');
    g.fillStyle = grad;
    g.fill();
    g.restore();
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = (tMs * i) / steps;
      const v = Math.min(m, Math.exp(CRASH_GROWTH * t));
      if (i === 0) g.moveTo(X(t), Y(v)); else g.lineTo(X(t), Y(v));
    }
    g.strokeStyle = col;
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();

    // cash-out markers
    for (const b of round?.bets || []) {
      if (b.cashedOutAt == null) continue;
      const bx = X(Math.min(tMs, crashTimeFor(b.cashedOutAt))), by = Y(Math.min(m, b.cashedOutAt));
      const isMine = mine && b.id === mine.id;
      g.fillStyle = isMine ? '#45e0a8' : 'rgba(69,224,168,0.55)';
      g.beginPath(); g.arc(bx, by, isMine ? 5 : 3.5, 0, Math.PI * 2); g.fill();
    }

    // tip
    g.fillStyle = crashed ? 'rgba(255,93,115,0.25)' : 'rgba(255,179,32,0.25)';
    g.beginPath(); g.arc(tipX, tipY, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = crashed ? '#ff5d73' : '#fff3d6';
    g.beginPath(); g.arc(tipX, tipY, 6, 0, Math.PI * 2); g.fill();
  }

  // ---------- frame loop ----------
  let lastReadout = '', lastSub = '', lastPhaseCls = '', endedT = 0;
  function setHud(text, subText, cls, barPct) {
    if (text !== lastReadout) { lastReadout = text; readout.textContent = text; }
    if (subText !== lastSub) { lastSub = subText; sub.textContent = subText; }
    if (cls !== lastPhaseCls) { lastPhaseCls = cls; graph.dataset.phase = cls; }
    bar.classList.toggle('hidden', barPct == null);
    if (barPct != null) bar.firstChild.style.width = `${barPct}%`;
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!round) { setHud('—', 'Connecting', 'idle'); drawGraph(0, 1, false); return; }
    if (round.phase === 'betting') {
      const left = Math.max(0, round.bettingEndsAt - serverNow());
      setHud(`${(left / 1000).toFixed(1)}s`, left > 0 ? 'Next round starts in' : 'Starting', 'betting', Math.min(100, (left / BETTING_MS) * 100));
      drawGraph(0, 1, false);
    } else if (round.phase === 'running') {
      const t = elapsed();
      const m = crashMultiplierAt(t);
      setHud(mult(m), activeMine() ? `Cash out now for ${usd(cashValue(m))}` : 'In flight', 'running');
      drawGraph(t, m, false);
    } else {
      const cp = round.crashPoint ?? 1;
      if (!endedT) endedT = round.startedAt ? Math.max(crashTimeFor(cp), 1) : 1;
      setHud(mult(cp), `Crashed at ${mult(cp)}`, 'ended');
      drawGraph(endedT, cp, true);
    }
    if (activeMine() && round.phase === 'running') paintButton();
  }

  // ---------- websocket ----------
  const offs = [
    onWs('hello', (m) => { setRound(m.crash.round, m.crash.myBetId); history = m.crash.history || []; renderHistory(); }),
    onWs('crash:round', (m) => {
      endedT = 0;
      setRound(m.round);
      if (queued && me()) { const spec = queued; queued = null; placeNow(spec); }
    }),
    onWs('crash:bet', (m) => { if (round && m.id === round.id) upsertBet(m.bet); }),
    onWs('crash:start', (m) => {
      if (!round || round.id !== m.id) round = { id: m.id, bets: [], bettingEndsAt: m.startedAt };
      round.phase = 'running';
      round.startedAt = m.startedAt;
      paintButton();
      renderPlayers();
    }),
    onWs('crash:cashout', (m) => { if (round && m.id === round.id) upsertBet(m.bet); }),
    onWs('crash:end', (m) => {
      if (!round || round.id !== m.id) round = { id: m.id, bets: [], startedAt: serverNow() - crashTimeFor(m.crashPoint) };
      round.phase = 'ended';
      round.crashPoint = m.crashPoint;
      round.hash = m.hash;
      endedT = round.startedAt ? Math.max(1, crashTimeFor(m.crashPoint)) : 1;
      history = m.history || history;
      renderHistory();
      renderPlayers();
      paintButton();
      if (!reduced()) { graph.classList.remove('shake'); void graph.offsetWidth; graph.classList.add('shake'); }
    }),
    ctx.store.on('me', () => { mine = null; setRound(round); }),
  ];

  ctx.api.get('/api/crash/state').then((s) => {
    // The hello message may have arrived first; only adopt this if it is not older.
    if (!round || (s.round && s.round.id >= round.id)) setRound(s.round, s.myBetId);
    if (!history.length) { history = s.history || []; renderHistory(); }
  }).catch(() => {});

  resize();
  renderPlayers();
  paintButton();
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    offs.forEach((off) => off());
  };
}
