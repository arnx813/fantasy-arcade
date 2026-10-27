// Minimal HTTP plumbing: router, JSON bodies, cookies, errors, rate limits.
export class HttpError extends Error {
  constructor(status, message, code = 'error', extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const badRequest = (msg, code = 'bad_request') => new HttpError(400, msg, code);
export const forbidden = (msg = 'Forbidden', code = 'forbidden') => new HttpError(403, msg, code);
export const notFound = (msg = 'Not found') => new HttpError(404, msg, 'not_found');

export class Router {
  routes = [];
  add(method, path, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  put(p, ...h) { this.add('PUT', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
    return pathMatched ? 'method' : null;
  }
}

export function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Body too large', 'too_large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (maxAge !== undefined) s += `; Max-Age=${maxAge}`;
  if (httpOnly) s += '; HttpOnly';
  if (secure) s += '; Secure';
  return s;
}

export function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(data);
}

// Token-bucket limiter keyed by an arbitrary string (ip, user id, ...).
export function rateLimiter({ capacity, refillPerSec }) {
  const buckets = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (now - b.t > 600_000) buckets.delete(k);
  }, 60_000).unref();
  return (key) => {
    const now = Date.now();
    const b = buckets.get(key) || { tokens: capacity, t: now };
    b.tokens = Math.min(capacity, b.tokens + ((now - b.t) / 1000) * refillPerSec);
    b.t = now;
    buckets.set(key, b);
    if (b.tokens < 1) throw new HttpError(429, 'Slow down', 'rate_limited');
    b.tokens -= 1;
  };
}
