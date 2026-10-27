// App state with a tiny pub/sub. Components subscribe to keys they render.
const state = { me: null, config: null, balance: 0, chatOpen: window.innerWidth > 1100, online: 0 };
const subs = new Map();

export const store = {
  get: (k) => state[k],
  set(k, v) {
    state[k] = v;
    (subs.get(k) || []).forEach((fn) => fn(v));
  },
  on(k, fn) {
    if (!subs.has(k)) subs.set(k, new Set());
    subs.get(k).add(fn);
    return () => subs.get(k).delete(fn);
  },
};
