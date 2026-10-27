import { toast } from './ui.js';

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Request failed (${status})`);
    this.status = status;
    this.code = data?.code;
    this.data = data;
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  del: (p) => request('DELETE', p),
};

// Wraps an action: shows the error toast and re-throws nothing. Returns undefined on failure.
export async function attempt(fn, { onAuth } = {}) {
  try {
    return await fn();
  } catch (e) {
    if (e.status === 401 && onAuth) onAuth();
    else toast(e.message, 'error');
    return undefined;
  }
}
