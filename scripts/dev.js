// `npm run dev`: API (mock) with restart on change + Vite dev server.
import { spawn } from 'node:child_process';
const run = (cmd, args, env = {}) => spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
const api = run(process.execPath, ['--watch', 'server/index.js'], { CARRY_MODE: 'mock', CARRY_DB: 'data/dev.db' });
const web = run('npm', ['run', 'dev', '-w', 'web']);
for (const c of [api, web]) c.on('exit', () => { api.kill(); web.kill(); process.exit(0); });
