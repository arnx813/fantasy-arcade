// Realtime fan-out. Every websocket client joins 'public' (live bets, chat, crash);
// authenticated clients also receive their own balance and game events.
const clients = new Set();

export function addClient(c) {
  clients.add(c);
  c.ws.on('close', () => clients.delete(c));
}
export function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of clients) c.ws.send(data);
}
export function toUser(userId, msg) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.userId === userId) c.ws.send(data);
}
export const onlineCount = () => clients.size;

setInterval(() => {
  for (const c of clients) {
    if (!c.ws.alive) { c.ws.close(1001); continue; }
    c.ws.alive = false;
    c.ws.ping();
  }
}, 30_000).unref();
