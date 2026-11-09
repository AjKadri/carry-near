import fs from 'node:fs';

// Load .env if present. Existing environment variables win.
if (fs.existsSync('.env')) process.loadEnvFile('.env');

export function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };
  const mode = (env.CARRY_MODE || 'mock').toLowerCase();
  if (!['mock', 'live'].includes(mode)) throw new Error(`CARRY_MODE must be mock or live, got "${mode}"`);
  return {
    mode,
    port: Number(env.PORT || 8787),
    // Loopback by default: the home endpoints have no login yet (see README, Roadmap).
    host: env.HOST || '127.0.0.1',
    dbPath: env.CARRY_DB || 'data/carry.db',
  };
}
