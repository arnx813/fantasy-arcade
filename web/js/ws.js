// One websocket, reconnecting with backoff; messages fan out by type.
const handlers = new Map();
let sock, backoff = 500, serverOffset = 0;

export const serverNow = () => Date.now() + serverOffset;
export function onWs(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => handlers.get(type).delete(fn);
}
export function sendWs(msg) {
  if (sock?.readyState === 1) sock.send(JSON.stringify(msg));
}
export function connectWs() {
  sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  sock.onopen = () => { backoff = 500; sendWs({ t: 'ping' }); };
  sock.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.serverTime) serverOffset = m.serverTime - Date.now();
    (handlers.get(m.t) || []).forEach((fn) => fn(m));
    (handlers.get('*') || []).forEach((fn) => fn(m));
  };
  sock.onclose = () => setTimeout(connectWs, (backoff = Math.min(backoff * 2, 10000)));
}
// Reconnect so the server re-reads the session cookie after login/logout.
export function reconnectWs() {
  if (sock) { sock.onclose = null; sock.close(); }
  connectWs();
}
