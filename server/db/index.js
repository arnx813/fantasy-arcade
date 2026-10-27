// Database access. SQLite (node:sqlite) runs synchronously in-process, so a
// transaction can never interleave with another request: balance updates are
// serialised by construction. To move to Postgres, re-implement this module's
// surface (one/all/run/tx/afterCommit) on a pg pool with SELECT ... FOR UPDATE.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

let db;
const stmtCache = new Map();
let txDepth = 0;
let afterCommitQueue = [];

export function openDb(path = config.dbPath) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  stmtCache.clear();
  return db;
}

const prep = (sql) => {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
};

export const one = (sql, ...args) => prep(sql).get(...args);
export const all = (sql, ...args) => prep(sql).all(...args);
export const run = (sql, ...args) => prep(sql).run(...args);
export const raw = () => db;

// Runs fn inside BEGIN IMMEDIATE / COMMIT. Nested calls join the outer transaction.
// Callbacks queued with afterCommit (e.g. websocket pushes) run only if it commits.
export function tx(fn) {
  if (txDepth > 0) {
    txDepth++;
    try {
      return fn();
    } finally {
      txDepth--;
    }
  }
  db.exec('BEGIN IMMEDIATE');
  txDepth = 1;
  let result;
  try {
    result = fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    afterCommitQueue = [];
    throw err;
  } finally {
    txDepth = 0;
  }
  const queue = afterCommitQueue;
  afterCommitQueue = [];
  for (const cb of queue) {
    try {
      cb();
    } catch (e) {
      console.error('afterCommit callback failed', e);
    }
  }
  return result;
}

export function afterCommit(cb) {
  if (txDepth === 0) cb();
  else afterCommitQueue.push(cb);
}

export function getSetting(key, fallback) {
  const row = one('SELECT value FROM settings WHERE key = ?', key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
