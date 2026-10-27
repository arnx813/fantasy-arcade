// Arena (player vs player) routes plus public profiles. Registered on the shared API
// router. Jackpot and duel endpoints answer 404 unless ARENA=1.
import { HttpError, badRequest, notFound } from '../lib/http.js';
import { config } from '../config.js';
import { one, all } from '../db/index.js';
import { vipFor } from '../services/vip.js';
import * as jackpot from '../services/jackpot.js';
import * as duels from '../services/duels.js';

const PVP = "('jackpot', 'duel')";
const requireUser = (ctx) => { if (!ctx.user) throw new HttpError(401, 'Sign in to continue', 'unauthenticated'); };
const arenaOnly = () => { if (!config.arena) throw notFound(); };
const geo = (ctx) => {
  if (ctx.country && config.blockedCountries.includes(ctx.country)) throw new HttpError(451, 'Fantasy Arcade is not available in your region', 'geo_blocked');
};

export function registerArena(api, { betLimit }) {
  const betGate = (ctx) => { arenaOnly(); requireUser(ctx); geo(ctx); betLimit(`u${ctx.user.id}`); };

  // ---- jackpot ----
  api.get('/api/arena/jackpot', () => { arenaOnly(); return jackpot.jackpotState(); });
  api.post('/api/arena/jackpot/enter', betGate, (ctx) => jackpot.placeJackpotEntry(ctx.user, ctx.body.amount));
  api.get('/api/arena/jackpot/rounds/:id', (ctx) => { arenaOnly(); return jackpot.jackpotRound(Number(ctx.params.id)) ?? (() => { throw notFound(); })(); });

  // ---- duels ----
  api.get('/api/arena/duels', () => { arenaOnly(); return { open: duels.openDuels(), recent: duels.recentDuels() }; });
  api.get('/api/arena/duels/:id', (ctx) => { arenaOnly(); return duels.duelById(Number(ctx.params.id)) ?? (() => { throw notFound(); })(); });
  api.post('/api/arena/duels', betGate, (ctx) => duels.createDuel(ctx.user, ctx.body.amount, ctx.body.side));
  api.post('/api/arena/duels/:id/join', betGate, (ctx) => duels.joinDuel(ctx.user, Number(ctx.params.id)));
  api.post('/api/arena/duels/:id/cancel', (ctx) => { arenaOnly(); requireUser(ctx); return duels.cancelDuel(ctx.user, Number(ctx.params.id)); });

  // ---- leaderboard: player-vs-player profit over a window ----
  api.get('/api/arena/leaderboard', (ctx) => {
    arenaOnly();
    const windows = { day: 86_400_000, week: 7 * 86_400_000, all: Infinity };
    const period = windows[ctx.query.period] ? ctx.query.period : 'day';
    const since = period === 'all' ? 0 : Date.now() - windows[period];
    const rows = all(`SELECT u.username, u.hidden, u.wagered, COUNT(*) AS games, SUM(b.amount) AS staked, SUM(b.payout) - SUM(b.amount) AS profit,
                             SUM(CASE WHEN b.payout > 0 THEN 1 ELSE 0 END) AS wins
                      FROM bets b JOIN users u ON u.id = b.user_id
                      WHERE b.game IN ${PVP} AND b.status = 'settled' AND b.settled_at > ?
                      GROUP BY b.user_id ORDER BY profit DESC LIMIT 20`, since);
    return { period, rows: rows.map((r) => ({ user: r.hidden ? null : r.username, vip: vipFor(r.wagered).name, games: r.games, wins: r.wins, staked: r.staked, profit: r.profit })) };
  });

  // ---- public profiles (both variants) ----
  api.get('/api/users/:username', (ctx) => {
    const u = one('SELECT * FROM users WHERE username = ?', ctx.params.username);
    if (!u || u.banned) throw notFound('Player not found');
    if (u.hidden && ctx.user?.id !== u.id) return { username: u.username, hidden: true };
    const stats = one("SELECT COUNT(*) AS bets FROM bets WHERE user_id = ? AND status = 'settled'", u.id);
    const best = one(`SELECT id, game, multiplier, payout FROM bets WHERE user_id = ? AND status = 'settled' AND payout > 0
                      ORDER BY multiplier DESC, payout DESC LIMIT 1`, u.id);
    const pvp = one(`SELECT
        SUM(CASE WHEN game = 'jackpot' THEN 1 ELSE 0 END) AS jackpotPlayed,
        SUM(CASE WHEN game = 'jackpot' AND payout > 0 THEN 1 ELSE 0 END) AS jackpotWon,
        SUM(CASE WHEN game = 'duel' THEN 1 ELSE 0 END) AS duelsPlayed,
        SUM(CASE WHEN game = 'duel' AND payout > 0 THEN 1 ELSE 0 END) AS duelsWon,
        COALESCE(SUM(payout) - SUM(amount), 0) AS net
      FROM bets WHERE user_id = ? AND game IN ${PVP} AND status = 'settled'`, u.id);
    const recent = all(`SELECT id, game, amount, payout, multiplier, settled_at AS at FROM bets
                        WHERE user_id = ? AND status = 'settled' ORDER BY settled_at DESC LIMIT 15`, u.id);
    return {
      username: u.username, hidden: !!u.hidden, joinedAt: u.created_at, vip: vipFor(u.wagered).name,
      wagered: u.wagered, bets: stats.bets, biggestWin: best || null,
      pvp: { jackpotPlayed: pvp.jackpotPlayed || 0, jackpotWon: pvp.jackpotWon || 0, duelsPlayed: pvp.duelsPlayed || 0, duelsWon: pvp.duelsWon || 0, net: pvp.net || 0 },
      recent,
    };
  });
}
