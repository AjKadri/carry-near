import fs from 'node:fs';

// Load .env if present. Existing environment variables win.
if (fs.existsSync('.env')) process.loadEnvFile('.env');

export function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };
  const mode = (env.CARRY_MODE || 'mock').toLowerCase();
  if (!['mock', 'live'].includes(mode)) throw new Error(`CARRY_MODE must be mock or live, got "${mode}"`);
  return {
    mode,
    handle: env.CARRY_HANDLE || 'demo',
    // HOME app (bills, allowance, reserve balance): loopback only, enforced again per request.
    homePort: Number(env.PORT || 8787),
    homeHost: env.HOST || '127.0.0.1',
    // PUBLIC app (pay page, phone API). Still loopback by default; put a reverse proxy in front for a real deployment.
    publicPort: Number(env.PUBLIC_PORT || 8788),
    publicHost: env.PUBLIC_HOST || '127.0.0.1',
    dbPath: env.CARRY_DB || 'data/carry.db',
    tickMs: Number(env.CARRY_TICK_MS || 5000),
    topUpEveryMs: Number(env.CARRY_TOPUP_MS || 5 * 60e3),
    live: {
      base: env.OUTLAYER_BASE || 'https://api.outlayer.ai',
      reserveKey: env.RESERVE_KEY, pocketKey: env.POCKET_KEY,
      reserveAccount: env.RESERVE_ACCOUNT, pocketAccount: env.POCKET_ACCOUNT,
      oneClickKey: env.ONECLICK_API_KEY,
      approver: { account: env.PROD_APPROVER_ACCOUNT, pubkey: env.PROD_APPROVER_PUBKEY, seed: env.PROD_APPROVER_SEED },
    },
  };
}

export function requireLive(c) {
  const missing = Object.entries({ RESERVE_KEY: c.live.reserveKey, POCKET_KEY: c.live.pocketKey, RESERVE_ACCOUNT: c.live.reserveAccount, POCKET_ACCOUNT: c.live.pocketAccount, ONECLICK_API_KEY: c.live.oneClickKey, PROD_APPROVER_ACCOUNT: c.live.approver.account, PROD_APPROVER_PUBKEY: c.live.approver.pubkey, PROD_APPROVER_SEED: c.live.approver.seed })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`live mode needs: ${missing.join(', ')}`);
}
