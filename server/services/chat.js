import { one, all, run } from '../db/index.js';
import { broadcast } from './hub.js';
import { vipFor } from './vip.js';

const lastSent = new Map();
const recent = [];

export function loadRecentChat() {
  const rows = all(`SELECT m.id, m.text, m.created_at, u.username, u.wagered, u.role FROM chat_messages m
                    JOIN users u ON u.id = m.user_id WHERE m.deleted = 0 ORDER BY m.id DESC LIMIT 50`).reverse();
  recent.splice(0, recent.length, ...rows.map(toMsg));
}
const toMsg = (r) => ({ id: r.id, user: r.username, vip: vipFor(r.wagered).name, admin: r.role === 'admin', text: r.text, at: r.created_at });
export const recentChat = () => recent;

export function postChat(user, text) {
  text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return { error: 'Empty message' };
  if (user.banned || user.muted_until > Date.now()) return { error: 'You are muted' };
  const last = lastSent.get(user.id) || 0;
  if (Date.now() - last < 1500) return { error: 'Slow down' };
  lastSent.set(user.id, Date.now());
  const id = Number(run('INSERT INTO chat_messages (user_id, text, created_at) VALUES (?, ?, ?)', user.id, text, Date.now()).lastInsertRowid);
  const msg = toMsg({ id, text, created_at: Date.now(), username: user.username, wagered: user.wagered, role: user.role });
  recent.push(msg);
  if (recent.length > 50) recent.shift();
  broadcast({ t: 'chat', msg });
  return { ok: true };
}

export function deleteChat(id) {
  run('UPDATE chat_messages SET deleted = 1 WHERE id = ?', id);
  const i = recent.findIndex((m) => m.id === id);
  if (i >= 0) recent.splice(i, 1);
  broadcast({ t: 'chat:delete', id });
}
