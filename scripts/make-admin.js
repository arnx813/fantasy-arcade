// Usage: npm run make-admin -- someone@example.com
import { openDb, one, run } from '../server/db/index.js';
const email = process.argv[2];
if (!email) { console.error('usage: npm run make-admin -- <email>'); process.exit(1); }
openDb();
const u = one('SELECT id, username FROM users WHERE email = ?', email.toLowerCase());
if (!u) { console.error(`no user with email ${email}`); process.exit(1); }
run("UPDATE users SET role = 'admin' WHERE id = ?", u.id);
console.log(`${u.username} is now an admin`);
