import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
if (config.mode === 'live') {
  console.error('CARRY_MODE=live is not built yet. Use CARRY_MODE=mock (default).');
  process.exit(1);
}
const db = openDb(config.dbPath);
createApp({ config, db }).listen(config.port, config.host, () => {
  console.log(`Carry (${config.mode} mode) on http://${config.host}:${config.port}`);
  if (config.mode === 'mock') console.log('Mock mode: no network calls, no keys used.');
});
