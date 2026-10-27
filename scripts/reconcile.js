// Ledger integrity check. Exits non-zero on any mismatch; run it from cron.
//  1. Every balance equals the sum of that user's ledger rows.
//  2. Every ledger row's balance_after equals the running sum at that row.
//  3. No settled bet is missing its stake row.
import { openDb, all, one } from '../server/db/index.js';
openDb();
let bad = 0;
for (const b of all('SELECT user_id, balance FROM balances')) {
  const s = one('SELECT COALESCE(SUM(delta), 0) AS s FROM ledger WHERE user_id = ?', b.user_id).s;
  if (s !== b.balance) { bad++; console.error(`user ${b.user_id}: balance ${b.balance} != ledger ${s}`); }
}
const drift = all(`SELECT id, user_id, balance_after, SUM(delta) OVER (PARTITION BY user_id ORDER BY id) AS running FROM ledger`).filter((r) => r.running !== r.balance_after);
for (const r of drift.slice(0, 20)) console.error(`ledger ${r.id} (user ${r.user_id}): balance_after ${r.balance_after} != running ${r.running}`);
bad += drift.length;
const orphan = one(`SELECT COUNT(*) AS n FROM bets b WHERE b.amount > 0 AND b.status <> 'void'
  AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.ref = 'bet:' || b.id AND l.kind = 'bet')`).n;
if (orphan) { bad++; console.error(`${orphan} bets without a stake row`); }
const users = one('SELECT COUNT(*) AS n FROM balances').n;
console.log(bad ? `FAILED: ${bad} problems` : `OK: ${users} balances reconcile`);
process.exit(bad ? 1 : 0);
