// `npm run demo`: build the web app if needed, then start Carry in mock mode.
// Forces mock mode and a throwaway database, so it never touches keys or mainnet.
import fs from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

if (!fs.existsSync('web/dist/index.html')) {
  console.log('Building web app...');
  const b = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
fs.rmSync('data/demo.db', { force: true });
const env = { ...process.env, CARRY_MODE: 'mock', CARRY_DB: 'data/demo.db' };
// Drop real keys from the child's environment so mock mode cannot use them.
for (const k of ['RESERVE_KEY', 'POCKET_KEY', 'ONECLICK_API_KEY', 'PROD_APPROVER_SEED']) delete env[k];
const child = spawn(process.execPath, ['server/index.js'], { stdio: 'inherit', env });
const base = `http://127.0.0.1:${env.PORT || 8787}`;
console.log(`\nHome view:  ${base}/home   (enter the setup code printed below)\nPay link:   ${base}/pay/${env.CARRY_HANDLE || 'demo'}\nPhone view: ${base}/phone (pair it from Home)\n`);
child.on('exit', (c) => process.exit(c ?? 0));
