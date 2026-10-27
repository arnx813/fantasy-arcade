import { one, run, tx } from '../db/index.js';
import { sha256, newServerSeed, newClientSeed } from '../lib/fair.js';
import { HttpError } from '../lib/http.js';

function create(userId, status, clientSeed = newClientSeed()) {
  const seed = newServerSeed();
  run('INSERT INTO seeds (user_id, server_seed, server_seed_hash, client_seed, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    userId, seed, sha256(seed), clientSeed, status, Date.now());
}

export function ensureSeeds(userId) {
  if (!one("SELECT id FROM seeds WHERE user_id = ? AND status = 'active'", userId)) create(userId, 'active');
  if (!one("SELECT id FROM seeds WHERE user_id = ? AND status = 'next'", userId)) create(userId, 'next');
}

// Reserves the next nonce on the active seed pair. Call inside the bet transaction.
export function takeNonce(userId) {
  ensureSeeds(userId);
  const s = one("SELECT * FROM seeds WHERE user_id = ? AND status = 'active'", userId);
  run('UPDATE seeds SET nonce = nonce + 1 WHERE id = ?', s.id);
  return { seed: s, nonce: s.nonce };
}

export function publicSeeds(userId) {
  ensureSeeds(userId);
  const a = one("SELECT client_seed, server_seed_hash, nonce FROM seeds WHERE user_id = ? AND status = 'active'", userId);
  const n = one("SELECT server_seed_hash FROM seeds WHERE user_id = ? AND status = 'next'", userId);
  return { clientSeed: a.client_seed, serverSeedHash: a.server_seed_hash, nonce: a.nonce, nextServerSeedHash: n.server_seed_hash };
}

export function rotate(userId, clientSeed) {
  clientSeed = String(clientSeed || '').trim() || newClientSeed();
  if (clientSeed.length > 64 || !/^[\x20-\x7e]+$/.test(clientSeed)) throw new HttpError(400, 'Client seed must be 1-64 printable characters');
  return tx(() => {
    if (one("SELECT id FROM bets WHERE user_id = ? AND status = 'active' AND game <> 'crash'", userId))
      throw new HttpError(400, 'Finish your active game before rotating seeds', 'active_game');
    ensureSeeds(userId);
    const prev = one("SELECT * FROM seeds WHERE user_id = ? AND status = 'active'", userId);
    run("UPDATE seeds SET status = 'revealed', revealed_at = ? WHERE id = ?", Date.now(), prev.id);
    run("UPDATE seeds SET status = 'active', client_seed = ? WHERE user_id = ? AND status = 'next'", clientSeed, userId);
    create(userId, 'next');
    return { revealed: { serverSeed: prev.server_seed, serverSeedHash: prev.server_seed_hash, clientSeed: prev.client_seed, nonce: prev.nonce }, current: publicSeeds(userId) };
  });
}
