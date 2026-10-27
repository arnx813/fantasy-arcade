// All runtime configuration comes from environment variables (see .env.example).
const env = process.env;
const num = (k, d) => (env[k] !== undefined ? Number(env[k]) : d);
const list = (k, d) => (env[k] !== undefined ? env[k].split(',').map((s) => s.trim()).filter(Boolean) : d);

export const USD = 1_000_000; // micro-USD per dollar

export const config = {
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  port: num('PORT', 8080),
  host: env.HOST || '0.0.0.0',
  dbPath: env.DB_PATH || new URL('../data/arcade.db', import.meta.url).pathname,
  publicOrigin: env.PUBLIC_ORIGIN || 'http://localhost:8080',
  trustProxy: env.TRUST_PROXY === '1',
  // Header your CDN/edge sets with the visitor's ISO country (e.g. CF-IPCountry).
  countryHeader: (env.COUNTRY_HEADER || 'cf-ipcountry').toLowerCase(),
  blockedCountries: list('BLOCKED_COUNTRIES', []),
  adminEmails: list('ADMIN_EMAILS', []),
  sessionDays: num('SESSION_DAYS', 30),

  // Betting limits (USD).
  minBet: num('MIN_BET_USD', 0) * USD,
  maxBet: num('MAX_BET_USD', 5000) * USD,
  maxProfit: num('MAX_PROFIT_USD', 50000) * USD,

  // Rewards.
  affiliateShare: num('AFFILIATE_SHARE', 0.1), // share of theoretical house edge
  // Withdrawals.
  minWithdrawal: num('MIN_WITHDRAWAL_USD', 10) * USD,
  withdrawRollover: num('WITHDRAW_ROLLOVER', 1), // wagered >= deposited * rollover
  kycWithdrawalThreshold: num('KYC_THRESHOLD_USD', 2000) * USD,

  // Payments: 'mock' in development; set to your gateway's adapter in production.
  paymentsProvider: env.PAYMENTS_PROVIDER || 'mock',
  paymentsWebhookSecret: env.PAYMENTS_WEBHOOK_SECRET || 'dev-payments-secret',
  // Aggregator (slots/live) seamless wallet.
  aggregatorSecret: env.AGGREGATOR_SECRET || 'dev-aggregator-secret',
  enableMockProvider: env.MOCK_PROVIDER !== '0' && env.NODE_ENV !== 'production',

  crash: {
    salt: env.CRASH_SALT || 'fantasy-arcade-dev-salt',
    chainLength: num('CRASH_CHAIN_LENGTH', 100000),
    bettingMs: num('CRASH_BETTING_MS', 7000),
    cooldownMs: num('CRASH_COOLDOWN_MS', 3000),
    timeScale: num('CRASH_TIME_SCALE', 1), // tests only: speeds rounds up; clients assume 1
  },
};

if (config.isProd) {
  for (const k of ['PAYMENTS_WEBHOOK_SECRET', 'AGGREGATOR_SECRET', 'CRASH_SALT', 'PUBLIC_ORIGIN']) {
    if (!env[k]) throw new Error(`${k} must be set in production`);
  }
}
