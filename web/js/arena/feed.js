// Live jackpot feed shared by the Arena home and the Jackpot page: initial fetch,
// websocket updates, resync on reconnect, and a balance hold so a winner's payout
// (pushed the instant the server draws) is not shown before the spin lands.
import { onWs, serverNow } from '../ws.js';

export function trackJackpot(ctx, { onRound, onDraw, onHistory }) {
  let round = null, drawn = null, holdTimer = 0, held = null, holding = false;
  const meId = () => ctx.store.get('me')?.id;
  const inRound = (r = round) => !!r && r.entries?.some((e) => e.userId === meId());

  function hold() {
    if (holding) return;
    holding = true;
    held = null;
    ctx.store.set('balanceHold', true);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(release, 15000); // never leave it frozen
  }
  function release() {
    clearTimeout(holdTimer);
    if (!holding) return;
    holding = false;
    ctx.store.set('balanceHold', false);
    if (held !== null) ctx.store.set('balance', held);
    else ctx.refreshMe();
    held = null;
  }

  function draw(r, spinMs, late) {
    if (drawn === r.id) return;
    drawn = r.id;
    round = r;
    if (inRound(r)) hold();
    onDraw(r, spinMs, { late });
  }
  function sync(state, late) {
    if (!state) return;
    if (state.history) onHistory?.(state.history);
    const r = state.round;
    if (!r) return;
    if (r.result && (r.status === 'drawing' || r.status === 'ended')) {
      if (r.status === 'ended' && drawn !== r.id) { drawn = r.id; round = r; onDraw(r, 0, { late: true, ended: true }); }
      else draw(r, 1400, late);
      return;
    }
    round = r;
    onRound(r);
  }

  // Hold just before the countdown ends if this player is in the round.
  const iv = setInterval(() => {
    if (round?.status === 'countdown' && inRound() && round.endsAt - serverNow() < 1500) hold();
  }, 200);

  const offs = [
    onWs('balance', (m) => { if (holding) held = m.balance; }),
    onWs('hello', (m) => m.jackpot && sync(m.jackpot, true)),
    onWs('jackpot:round', (m) => { round = m.round; onRound(m.round, { fresh: true }); }),
    onWs('jackpot:entry', (m) => { if (drawn !== m.round.id) { round = m.round; onRound(m.round); } }),
    onWs('jackpot:draw', (m) => draw(m.round, m.spinMs, false)),
    onWs('jackpot:ended', (m) => onHistory?.(m.history, { ended: m.id })),
  ];
  ctx.api.get('/api/arena/jackpot').then((s) => sync(s, true)).catch(() => {});

  return {
    get round() { return round; },
    release,
    stop() { clearInterval(iv); offs.forEach((f) => f()); release(); },
  };
}
