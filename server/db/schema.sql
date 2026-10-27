-- Fantasy Arcade schema (SQLite). Money is INTEGER in micro-USD (1 USD = 1,000,000).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  referral_code TEXT NOT NULL UNIQUE,
  referred_by INTEGER REFERENCES users(id),
  wagered INTEGER NOT NULL DEFAULT 0,          -- lifetime wager, drives VIP level
  rakeback_accrued INTEGER NOT NULL DEFAULT 0, -- claimable
  affiliate_accrued INTEGER NOT NULL DEFAULT 0,-- claimable commission from referrals
  affiliate_lifetime INTEGER NOT NULL DEFAULT 0,
  deposited INTEGER NOT NULL DEFAULT 0,        -- lifetime deposits, for withdrawal rollover
  hidden INTEGER NOT NULL DEFAULT 0,           -- hide name in public feeds
  kyc_status TEXT NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none', 'pending', 'verified', 'rejected')),
  banned INTEGER NOT NULL DEFAULT 0,
  muted_until INTEGER NOT NULL DEFAULT 0,
  self_excluded_until INTEGER NOT NULL DEFAULT 0,
  loss_limit_daily INTEGER,                    -- null = none
  wager_limit_daily INTEGER,
  pending_limits TEXT,                         -- JSON {loss_limit_daily, wager_limit_daily, effective_at}
  country TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS balances (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0)
);

-- Append-only. Every balance change has exactly one row; balance_after makes
-- reconciliation a single query (see scripts/reconcile.js).
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, id);
CREATE INDEX IF NOT EXISTS ledger_kind_time ON ledger(kind, created_at);
CREATE INDEX IF NOT EXISTS ledger_user_time ON ledger(user_id, created_at);

CREATE TABLE IF NOT EXISTS seeds (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  client_seed TEXT NOT NULL,
  nonce INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active', 'next', 'revealed')),
  created_at INTEGER NOT NULL,
  revealed_at INTEGER
);
CREATE INDEX IF NOT EXISTS seeds_user ON seeds(user_id, status);

CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  game TEXT NOT NULL,
  amount INTEGER NOT NULL,        -- total wagered incl. doubles/splits
  base_amount INTEGER NOT NULL,   -- unit stake for multi-unit games
  payout INTEGER NOT NULL DEFAULT 0,
  multiplier REAL NOT NULL DEFAULT 0,
  seed_id INTEGER REFERENCES seeds(id),
  nonce INTEGER,
  params TEXT NOT NULL DEFAULT '{}',
  state TEXT,                      -- server-only state for in-progress games
  outcome TEXT,                    -- public result
  status TEXT NOT NULL CHECK (status IN ('active', 'settled', 'void')),
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);
CREATE INDEX IF NOT EXISTS bets_user ON bets(user_id, id);
CREATE INDEX IF NOT EXISTS bets_game_time ON bets(game, created_at);
-- One in-progress round per player per house game. Shared/PvP games are exempt: a
-- player can hold several open duels, and jackpot/crash bets live with their round.
-- (Migration: the first version of this index also covered duels; drop it by name.)
DROP INDEX IF EXISTS bets_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS bets_one_active_v2 ON bets(user_id, game) WHERE status = 'active' AND game NOT IN ('crash', 'duel', 'jackpot');

CREATE TABLE IF NOT EXISTS crash_chain (
  id INTEGER PRIMARY KEY,          -- chain generation
  terminal_hash TEXT NOT NULL,     -- published commitment
  salt TEXT NOT NULL,
  length INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS crash_hashes (
  chain_id INTEGER NOT NULL REFERENCES crash_chain(id),
  idx INTEGER NOT NULL,            -- 0 = seed, length = terminal
  hash TEXT NOT NULL,
  PRIMARY KEY (chain_id, idx)
);
CREATE TABLE IF NOT EXISTS crash_rounds (
  id INTEGER PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  chain_idx INTEGER NOT NULL,
  hash TEXT NOT NULL,
  crash_point REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('betting', 'running', 'ended', 'void')),
  started_at INTEGER,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS deposit_addresses (
  user_id INTEGER NOT NULL REFERENCES users(id),
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  memo TEXT,
  PRIMARY KEY (user_id, chain)
);
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  chain TEXT NOT NULL,
  asset TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  asset_amount TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'credited')),
  created_at INTEGER NOT NULL,
  UNIQUE (provider, tx_hash)
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  chain TEXT NOT NULL,
  asset TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'rejected', 'failed')),
  tx_hash TEXT,
  note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Third-party (aggregator) seamless-wallet transactions. provider_tx_id is the
-- aggregator's id and makes debit/credit/rollback idempotent.
CREATE TABLE IF NOT EXISTS provider_txns (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_tx_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  game_id TEXT,
  round_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('debit', 'credit', 'rollback')),
  amount INTEGER NOT NULL,
  rolled_back INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_tx_id)
);
CREATE TABLE IF NOT EXISTS provider_games (
  id TEXT PRIMARY KEY,             -- provider:game
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('slots', 'live', 'table')),
  studio TEXT,
  rtp REAL,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS launch_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  game_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);

-- ---------------- Arena (player vs player) ----------------
-- Jackpot: players pool stakes, one winner drawn weighted by stake. The round's
-- server seed hash is published when the round opens; the seed is revealed after.
CREATE TABLE IF NOT EXISTS pvp_rounds (
  id INTEGER PRIMARY KEY,
  game TEXT NOT NULL DEFAULT 'jackpot',
  server_seed TEXT NOT NULL,
  seed_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'countdown', 'drawing', 'ended', 'void')),
  pot INTEGER NOT NULL DEFAULT 0,
  rake INTEGER NOT NULL DEFAULT 0,
  winner_id INTEGER REFERENCES users(id),
  ticket INTEGER,
  entries_digest TEXT,
  created_at INTEGER NOT NULL,
  ends_at INTEGER,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS pvp_entries (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES pvp_rounds(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pvp_entries_round ON pvp_entries(round_id, id);

-- Coinflip duels: the creator escrows a stake and picks a side; anyone can take the
-- other side. The seed hash is shown from creation; the result needs both player ids.
CREATE TABLE IF NOT EXISTS duels (
  id INTEGER PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  joiner_id INTEGER REFERENCES users(id),
  amount INTEGER NOT NULL,
  creator_side TEXT NOT NULL CHECK (creator_side IN ('heads', 'tails')),
  server_seed TEXT NOT NULL,
  seed_hash TEXT NOT NULL,
  result TEXT,
  winner_id INTEGER REFERENCES users(id),
  payout INTEGER,
  status TEXT NOT NULL CHECK (status IN ('open', 'done', 'cancelled')),
  creator_bet_id INTEGER,
  joiner_bet_id INTEGER,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);
CREATE INDEX IF NOT EXISTS duels_status ON duels(status, id);
