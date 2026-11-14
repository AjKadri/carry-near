// The public sandbox: every visitor gets their OWN in-memory mock world (store, mock OutLayer and 1Click, home key, pairing),
// chosen by a random session cookie. Mock mode only: nothing here can load live keys or touch the live instance.
//
//   createSandbox()   the session manager + HTTP dispatcher (used by server/sandbox-main.js, the tests and `npm run attack -- --sandbox`)
//   assertMockOnly()  the start-up guard: refuses to run unless CARRY_MODE is exactly "mock" and no live key is in the environment
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { loadConfig } from './config.js';
import { createServices } from './services.js';
import { createApp } from './app.js';

export const COOKIE = 'carry_sbx';
const LIVE_KEY_VARS = ['RESERVE_KEY', 'POCKET_KEY', 'RESERVE_ACCOUNT', 'POCKET_ACCOUNT', 'ONECLICK_API_KEY', 'PROD_APPROVER_ACCOUNT', 'PROD_APPROVER_PUBKEY', 'PROD_APPROVER_SEED'];

export function assertMockOnly(env = process.env) {
  if (env.CARRY_MODE !== 'mock') throw new Error(`the sandbox runs in mock mode only: set CARRY_MODE=mock (got ${JSON.stringify(env.CARRY_MODE ?? null)}). Refusing to start.`);
  const present = LIVE_KEY_VARS.filter((k) => env[k]);
  if (present.length) throw new Error(`the sandbox must never see live keys, but ${present.join(', ')} ${present.length > 1 ? 'are' : 'is'} set in the environment. Refusing to start.`);
}

const parseCookie = (h = '') => { const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,64})`).exec(h); return m ? m[1] : null; };

export function createSandbox({
  max = 500,                  // most worlds alive at once; the least recently used is dropped first
  idleMs = 2 * 3600e3,        // a world nobody has touched for this long is dropped
  activeMs = 15 * 60e3,       // only worlds touched this recently get their 5 s engine tick
  perIpPerHour = 30,          // new worlds one IP address may create per hour
  tickMs = 5000,
  now = Date.now,
  mockOpts = {},
  settleOpts,
  env = {},                   // extra config overrides for each world (tests; always mock)
  dist = path.resolve('web/dist'),
} = {}) {
  const sessions = new Map(); // id -> { id, world (promise or world), last }  (insertion order = recency order)
  const ipHits = new Map();   // ip -> [timestamps]
  const retire = (world) => setTimeout(() => { try { world.svc.store.close(); } catch { /* already closed */ } }, 30_000).unref?.(); // let in-flight requests finish

  async function makeWorld() {
    const config = loadConfig({ ...env, CARRY_MODE: 'mock', CARRY_DB: ':memory:' }); // forced: whatever the environment says
    if (config.mode !== 'mock') throw new Error('sandbox world must be mock');
    const svc = createServices(config, { now, mockOpts, settleOpts });
    await svc.start();
    return { svc, app: createApp(svc, { sandbox: true, noStatic: true }) };
  }

  function evict() {
    while (sessions.size > max) { const [id, s] = sessions.entries().next().value; sessions.delete(id); Promise.resolve(s.world).then(retire).catch(() => {}); }
  }
  function sweep() {
    const t = now();
    for (const [id, s] of sessions) if (t - s.last > idleMs) { sessions.delete(id); Promise.resolve(s.world).then(retire).catch(() => {}); }
  }
  const sweeper = setInterval(sweep, 60_000); sweeper.unref?.();

  const self = {
    sessions,
    get size() { return sessions.size; },
    // create a world and register it under a fresh random id
    async create() {
      const id = crypto.randomBytes(24).toString('base64url');
      const s = { id, last: now(), world: null };
      s.world = makeWorld(); sessions.set(id, s); evict();
      s.world = await s.world; // a failed build must not leave a broken session behind
      return s;
    },
    async worldOf(id) { const s = sessions.get(id); return s ? s.world : null; },
    touch(s) { s.last = now(); sessions.delete(s.id); sessions.set(s.id, s); },
    // may this IP start another world right now?
    allowNew(ip) {
      const t = now(), recent = (ipHits.get(ip) ?? []).filter((x) => t - x < 3600e3);
      if (recent.length >= perIpPerHour) { ipHits.set(ip, recent); return false; }
      recent.push(t); ipHits.set(ip, recent);
      if (ipHits.size > 5000) for (const [k, v] of ipHits) if (!v.some((x) => t - x < 3600e3)) ipHits.delete(k);
      return true;
    },
    sweep,
    // the engine tick for every recently used world, one after another
    async tickAll() {
      const t = now();
      for (const s of [...sessions.values()]) {
        if (t - s.last > activeMs) continue;
        const w = await s.world; await w.svc.tick();
      }
    },
    close() { clearInterval(sweeper); },
  };

  // ------------------------------------------------------------------------------------ HTTP
  const server = express();
  server.set('trust proxy', 'loopback');
  server.disable('x-powered-by');
  server.use((_req, res, next) => {
    res.set({ 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    next();
  });
  server.get('/api/health', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, sandbox: true, worlds: sessions.size }); });
  // Everything under /api belongs to one visitor's world, picked by the cookie. A visitor without a (still valid) cookie gets a new world, if their IP is allowed one.
  server.use(async (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    try {
      let s = sessions.get(parseCookie(req.get('cookie')) ?? '');
      if (req.method === 'POST' && req.path === '/api/sandbox/reset') { // "Reset my demo": a brand new world under the same cookie
        if (!s && !self.allowNew(req.ip)) return res.status(429).json({ error: 'too many new demos from this address, try again later' });
        const old = s; const id = s?.id ?? crypto.randomBytes(24).toString('base64url');
        const fresh = { id, last: now(), world: makeWorld() }; sessions.set(id, fresh); evict();
        fresh.world = await fresh.world;
        if (old) Promise.resolve(old.world).then(retire).catch(() => {});
        res.cookie(COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: idleMs });
        return res.json({ ok: true });
      }
      if (!s) {
        if (!self.allowNew(req.ip)) return res.status(429).json({ error: 'too many new demos from this address, try again later' });
        s = await self.create();
        res.cookie(COOKIE, s.id, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: idleMs });
      }
      self.touch(s);
      const w = await s.world;
      return w.app(req, res, next);
    } catch (err) { console.error('sandbox error:', err.message); res.status(500).json({ error: 'sandbox error' }); }
  });
  if (fs.existsSync(dist)) {
    server.use(express.static(dist));
    server.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  self.handler = server;
  return self;
}
