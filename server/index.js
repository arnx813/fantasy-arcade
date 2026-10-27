// Fantasy Arcade server: HTTP API, static web client, and websocket on /ws.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config } from './config.js';
import { openDb } from './db/index.js';
import { api } from './routes/api.js';
import { HttpError, readBody, parseCookies, sendJson } from './lib/http.js';
import { acceptUpgrade } from './lib/ws.js';
import { userForToken } from './services/users.js';
import { addClient } from './services/hub.js';
import { startCrashLoop, stopCrashLoop, crashState } from './services/crash.js';
import { startJackpotLoop, stopJackpotLoop, jackpotState } from './services/jackpot.js';
import { postChat, recentChat, loadRecentChat } from './services/chat.js';
import { seedMockCatalog } from './services/aggregator.js';
import { one } from './db/index.js';

const ROOT = new URL('..', import.meta.url).pathname;
const STATIC = [
  ['/shared/', join(ROOT, 'shared')],
  ['/', join(ROOT, 'web')],
];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "frame-src 'self'",
    "frame-ancestors 'self'",
  ].join('; '),
};

function clientIp(req) {
  if (config.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress;
}

async function serveStatic(req, res, pathname) {
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    const rel = normalize(decodeURIComponent(pathname.slice(prefix.length))).replace(/^(\.\.[/\\])+/, '');
    let file = join(dir, rel);
    if (!file.startsWith(dir)) break;
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': TYPES[extname(file)] || 'application/octet-stream',
        'cache-control': config.isProd && !file.endsWith('.html') ? 'public, max-age=300' : 'no-cache',
      });
      return res.end(body);
    } catch {
      if (prefix === '/shared/') break;
      // SPA fallback: any unknown non-file route renders the app shell.
      if (!extname(pathname)) {
        const body = await readFile(join(dir, 'index.html'));
        res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
        return res.end(body);
      }
    }
  }
  res.writeHead(404, SECURITY_HEADERS);
  res.end('Not found');
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const cookies = parseCookies(req.headers.cookie);
  const setCookies = [];
  try {
    const m = api.match(req.method, pathname);
    if (!m) throw new HttpError(404, 'Not found', 'not_found');
    if (m === 'method') throw new HttpError(405, 'Method not allowed', 'method_not_allowed');
    let raw = Buffer.alloc(0), body = {};
    if (req.method !== 'GET') {
      // JSON-only bodies plus a same-origin check block cross-site form posts (CSRF).
      const type = req.headers['content-type'] || '';
      raw = await readBody(req);
      if (raw.length) {
        if (!type.startsWith('application/json')) throw new HttpError(415, 'Expected application/json', 'bad_content_type');
        try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON', 'bad_json'); }
      }
      const origin = req.headers.origin;
      const external = pathname.startsWith('/api/payments/') || pathname.startsWith('/api/aggregator/');
      if (origin && !external && origin !== config.publicOrigin && new URL(origin).host !== req.headers.host)
        throw new HttpError(403, 'Cross-origin request blocked', 'bad_origin');
    }
    const ctx = {
      req, res, url, raw, body,
      params: m.params,
      query: Object.fromEntries(url.searchParams),
      token: cookies.fa_sid,
      user: userForToken(cookies.fa_sid),
      ip: clientIp(req),
      country: String(req.headers[config.countryHeader] || '').toUpperCase() || null,
      setCookie: (c) => setCookies.push(c),
    };
    ctx.meta = { ip: ctx.ip, userAgent: req.headers['user-agent'] };
    let result;
    for (const h of m.route.handlers) result = await h(ctx);
    sendJson(res, 200, result ?? { ok: true }, { ...SECURITY_HEADERS, ...(setCookies.length ? { 'set-cookie': setCookies } : {}) });
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message, code: err.code, ...(err.extra || {}) }, SECURITY_HEADERS);
    } else {
      console.error(err);
      sendJson(res, 500, { error: 'Something went wrong', code: 'internal' }, SECURITY_HEADERS);
    }
  }
}

function onUpgrade(req, socket) {
  if (new URL(req.url, 'http://local').pathname !== '/ws') return socket.destroy();
  const ws = acceptUpgrade(req, socket);
  if (!ws) return;
  const client = { ws, userId: null };
  const refresh = () => {
    const u = userForToken(parseCookies(req.headers.cookie).fa_sid);
    client.userId = u?.id ?? null;
    return u;
  };
  refresh();
  addClient(client);
  ws.send({ t: 'hello', crash: crashState(client.userId), chat: recentChat(), ...(config.arena ? { jackpot: jackpotState() } : {}) });
  ws.on('message', (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.t === 'chat') {
      const u = client.userId && one('SELECT * FROM users WHERE id = ?', client.userId);
      if (!u) return ws.send({ t: 'chat:error', error: 'Sign in to chat' });
      const r = postChat(u, msg.text);
      if (r.error) ws.send({ t: 'chat:error', error: r.error });
    } else if (msg.t === 'auth') {
      refresh(); // client re-sends after login/logout; cookie is re-read from the upgrade request
    } else if (msg.t === 'ping') ws.send({ t: 'pong', serverTime: Date.now() });
  });
}

export function start({ port = config.port, dbPath = config.dbPath, crashLoop = true } = {}) {
  openDb(dbPath);
  seedMockCatalog();
  loadRecentChat();
  if (crashLoop) startCrashLoop();
  if (config.arena) startJackpotLoop();
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong' });
    });
  });
  server.on('upgrade', onUpgrade);
  server.listen(port, config.host);
  server.on('close', () => { stopCrashLoop(); stopJackpotLoop(); });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = start();
  s.on('listening', () => console.log(`Fantasy Arcade on http://localhost:${s.address().port}`));
  const shutdown = () => { stopCrashLoop(); s.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
