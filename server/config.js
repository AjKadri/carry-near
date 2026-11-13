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
    payeeName: env.CARRY_PAYEE_NAME || env.CARRY_HANDLE || 'demo', // who the pay page says is being paid
    // One app: pay page, phone API and signed home routes. Loopback by default; a reverse proxy (Caddy) fronts it when deployed.
    port: Number(env.PORT || 8787),
    host: env.HOST || '127.0.0.1',
    publicUrl: env.CARRY_PUBLIC_URL || null, // used in the pairing QR; falls back to the browser's own origin
    exitAccount: env.CARRY_EXIT_ACCOUNT || 'nearhacka.near',
    dbPath: env.CARRY_DB || 'data/carry.db',
    tickMs: Number(env.CARRY_TICK_MS || 5000),
    topUpEveryMs: Number(env.CARRY_TOPUP_MS || 5 * 60e3),
    // Mock/demo only (never read in live mode, which always starts at 0): the refill allowance a fresh demo database starts with.
    // 3 USDC means the first 5 USDC payment visibly splits: 3 to the pocket, 2 stays Protected.
    demoAllowance: BigInt(Math.round(Number(env.CARRY_DEMO_ALLOWANCE_USDC ?? 3) * 1e6)),
    // The pocket's two limits, shown on the phone. Mirror the locked pocket policy (live: enforced by OutLayer, not by these numbers).
    phone: {
      ceiling: BigInt(Math.round(Number(env.CARRY_PHONE_CEILING_USDC ?? 20) * 1e6)), // what the pocket holds at most (refill ceiling)
      perTx: BigInt(Math.round(Number(env.CARRY_PHONE_TX_USDC ?? 10) * 1e6)),         // what the phone may send in one transaction
    },
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
