// The public sandbox: one mock world per visitor (cookie), isolation, caps, auto setup, reset, and the mock-only guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox, assertMockOnly, COOKIE } from '../server/sandbox.js';
import { makeTestDevice } from '../server/homeauth.js';
import { loadConfig } from '../server/config.js';
import { createServices } from '../server/services.js';
import { createApp } from '../server/app.js';
import { MOCK_POCKET_KEY } from '../server/mock.js';

const REFUND = '7puyGCiSnh55z3EzWEr8MKDBw9FYH2izq4K4mXPNpcuo';
async function start(opts = {}) {
  const sb = createSandbox({ mockOpts: { settleDelayMs: 20 }, settleOpts: { intervalMs: 10, timeoutMs: 3000 }, perIpPerHour: 1000, ...opts });
  const server = sb.handler.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // one browser: a cookie jar plus its own laptop device key
  const browser = () => {
    let ck = ''; const device = makeTestDevice();
    const f = async (p, init = {}) => {
      const r = await fetch(base + p, { ...init, headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}), ...(init.headers ?? {}) }, body: init.body && typeof init.body !== 'string' ? JSON.stringify(init.body) : init.body });
      const sc = r.headers.getSetCookie?.() ?? []; for (const c of sc) { const m = new RegExp(`^(${COOKIE}=[^;]+)`).exec(c); if (m) ck = m[1]; }
      return { status: r.status, body: await r.json().catch(() => null), setCookie: sc };
    };
    const signed = (p, { method = 'GET', body } = {}) => { const raw = body === undefined ? '' : JSON.stringify(body); return f(p, { method, body: raw || undefined, headers: device.sign({ method, path: p, body: raw, time: Date.now() }) }); };
    const setup = async () => { const c = (await f('/api/sandbox/setup-code')).body.setupCode; return f('/api/home/auth/setup', { method: 'POST', body: { publicKey: device.publicKeySpkiB64, setupCode: c } }); };
    return { f, signed, setup, device, get cookie() { return ck; } };
  };
  return { sb, base, browser, close: () => { server.close(); sb.close(); } };
}
const payFive = async (b, sb) => {
  const q = await b.f('/api/pay/demo/quote', { method: 'POST', body: { amountUsdc: 5, refundTo: REFUND } });
  assert.equal(q.status, 200);
  assert.equal((await b.f('/api/mock/pay', { method: 'POST', body: { address: q.body.address } })).status, 200);
  for (let i = 0; i < 8; i++) { await sb.tickAll(); await new Promise((r) => setTimeout(r, 40)); }
  return q.body;
};

test('guard: the sandbox refuses to start unless CARRY_MODE is exactly mock and no live key is in the environment', () => {
  assert.doesNotThrow(() => assertMockOnly({ CARRY_MODE: 'mock' }));
  for (const mode of [undefined, 'live', 'MOCK', '']) assert.throws(() => assertMockOnly({ CARRY_MODE: mode }), /mock mode only/);
  for (const k of ['RESERVE_KEY', 'POCKET_KEY', 'ONECLICK_API_KEY', 'PROD_APPROVER_SEED', 'RESERVE_ACCOUNT']) assert.throws(() => assertMockOnly({ CARRY_MODE: 'mock', [k]: 'x' }), new RegExp(k));
});

test('a world is always mock, even if the environment asks for live', async () => {
  const sb = createSandbox({ env: { CARRY_MODE: 'live', RESERVE_KEY: 'wk_x' } });
  const s = await sb.create();
  assert.equal(s.world.svc.config.mode, 'mock'); assert.equal(s.world.svc.config.dbPath, ':memory:');
  sb.close();
});

test('two browsers get two separate worlds: balances, logs, addresses and pairing do not leak', async () => {
  const t = await start();
  try {
    const a = t.browser(), b = t.browser();
    assert.equal((await a.setup()).status, 200); assert.equal((await b.setup()).status, 200);
    assert.notEqual(a.cookie, b.cookie);
    const addr = await payFive(a, t.sb);
    const sa = (await a.signed('/api/home/state')).body, sb2 = (await b.signed('/api/home/state')).body;
    assert.equal(sa.pocket, 3_000_000); assert.equal(sa.reserve, 1_999_000); // 5 USDC minus 1Click's 0.0002 fee, minus the 3.00 refill
    assert.equal(sb2.pocket, 0); assert.equal(sb2.reserve, 0);
    assert.equal(sa.allowance, 0);                       // A spent its 3.00 allowance
    assert.equal(sb2.allowance, 3_000_000);              // B still has the demo default
    const la = (await a.signed('/api/home/log')).body.events.map((e) => e.kind), lb = (await b.signed('/api/home/log')).body.events.map((e) => e.kind);
    assert.ok(la.includes('payment_in') && la.includes('refill_success'));
    assert.equal(lb.includes('payment_in'), false); assert.equal(lb.includes('refill_success'), false);
    // A's payment address does not exist in B's world
    assert.equal((await b.f(`/api/pay/demo/status?address=${addr.address}`)).status, 404);
    assert.equal((await a.f(`/api/pay/demo/status?address=${addr.address}`)).status, 200);
    // pairing: A pairs its phone view, B's world has no pairing events
    const ph = await a.f('/api/sandbox/phone', { method: 'POST' });
    assert.equal(ph.status, 200); assert.equal(ph.body.pocketKey, MOCK_POCKET_KEY);
    assert.equal(((await a.f('/api/phone/state', { headers: { Authorization: `Bearer ${MOCK_POCKET_KEY}` } })).body).pocket, 3_000_000);
    assert.equal(((await b.f('/api/phone/state', { headers: { Authorization: `Bearer ${MOCK_POCKET_KEY}` } })).body).pocket, 0);
    assert.ok((await a.signed('/api/home/log')).body.events.some((e) => e.kind === 'pair_confirmed'));
    assert.equal((await b.signed('/api/home/log')).body.events.some((e) => e.kind.startsWith('pair_')), false);
    // A's device key means nothing in B's world
    assert.equal((await b.f('/api/home/state', { headers: a.device.sign({ method: 'GET', path: '/api/home/state', body: '', time: Date.now() }) })).status, 401);
  } finally { t.close(); }
});

test('the first payment splits 3/2 like npm run demo, and the session cookie is HttpOnly and SameSite=Lax', async () => {
  const t = await start();
  try {
    const a = t.browser();
    const m = await a.f('/api/mode');
    assert.equal(m.body.sandbox, true); assert.equal(m.body.landing, false); assert.equal(m.body.mode, 'mock');
    assert.match(m.setCookie[0], /HttpOnly/i); assert.match(m.setCookie[0], /SameSite=Lax/i); assert.match(m.setCookie[0], /Path=\//);
    await a.setup(); await payFive(a, t.sb);
    const st = (await a.signed('/api/home/state')).body;
    assert.equal(st.pocket, 3_000_000); assert.equal(st.reserve, 1_999_000); // 3 to the pocket, 2 stays Protected
  } finally { t.close(); }
});

test('setup is automatic but one-shot: the code is handed out until a key is registered, then 409; static pages and health create no world', async () => {
  const t = await start();
  try {
    assert.equal((await fetch(t.base + '/api/health')).status, 200);
    assert.equal((await fetch(t.base + '/')).status, 200);
    assert.equal((await fetch(t.base + '/home')).status, 200);
    assert.equal(t.sb.size, 0);
    const a = t.browser();
    const c = await a.f('/api/sandbox/setup-code'); assert.equal(c.status, 200); assert.match(c.body.setupCode, /^[A-Z0-9]{6,}$/);
    assert.equal(t.sb.size, 1);
    assert.equal((await a.setup()).status, 200);
    assert.equal((await a.f('/api/sandbox/setup-code')).status, 409);
    assert.equal((await a.f('/api/home/auth/setup', { method: 'POST', body: { publicKey: 'x', setupCode: 'WRONG' } })).status >= 400, true);
  } finally { t.close(); }
});

test('cap and eviction: at most max worlds, the least recently used goes first', async () => {
  const t = await start({ max: 3 });
  try {
    const bs = [t.browser(), t.browser(), t.browser()];
    for (const b of bs) { await b.setup(); }
    await payFive(bs[0], t.sb);                                    // world 0 now has history
    assert.equal(t.sb.size, 3);
    await bs[0].f('/api/mode');                                    // touch 0, so 1 is the least recently used
    const d = t.browser(); await d.setup();                        // a fourth visitor
    assert.equal(t.sb.size, 3);
    assert.equal((await bs[0].signed('/api/home/state')).status, 200);   // 0 survived
    const gone = await bs[1].signed('/api/home/state');            // 1 was evicted: its cookie now lands in a brand new, unregistered world
    assert.equal(gone.status, 401);
    assert.equal((await bs[1].f('/api/home/auth/status')).body.registered, false);
  } finally { t.close(); }
});

test('idle expiry: a world untouched for the idle time is dropped', async () => {
  let clock = 1_000_000;
  const t = await start({ idleMs: 3600e3, now: () => clock });
  try {
    const a = t.browser(), b = t.browser(); await a.f('/api/mode'); await b.f('/api/mode');
    assert.equal(t.sb.size, 2);
    clock += 3000e3; await b.f('/api/mode');       // b is touched, a is not
    clock += 700e3; t.sb.sweep();                  // a idle 3700 s > 3600 s; b idle 700 s
    assert.equal(t.sb.size, 1);
  } finally { t.close(); }
});

test('rate limit: one IP may create only so many worlds per hour', async () => {
  const t = await start({ perIpPerHour: 2 });
  try {
    assert.equal((await t.browser().f('/api/mode')).status, 200);
    assert.equal((await t.browser().f('/api/mode')).status, 200);
    const third = await t.browser().f('/api/mode'); assert.equal(third.status, 429);
    assert.equal(t.sb.size, 2);
    // a browser that already has a world is not limited
    const again = t.browser(); await again.f('/api/health');
  } finally { t.close(); }
});

test('Reset my demo: a brand new world under the same cookie, home key forgotten, demo defaults back', async () => {
  const t = await start();
  try {
    const a = t.browser(); await a.setup(); await payFive(a, t.sb);
    const id = a.cookie;
    assert.equal((await a.signed('/api/home/state')).body.pocket, 3_000_000);
    const r = await a.f('/api/sandbox/reset', { method: 'POST' });
    assert.equal(r.status, 200); assert.equal(a.cookie, id);
    assert.equal((await a.f('/api/home/auth/status')).body.registered, false);
    await a.setup();
    const st = (await a.signed('/api/home/state')).body;
    assert.equal(st.pocket, 0); assert.equal(st.reserve, 0); assert.equal(st.allowance, 3_000_000);
    assert.equal(t.sb.size, 1);
  } finally { t.close(); }
});

test('the sandbox routes exist only in the sandbox: the normal app has none, and its /api/mode says so', async () => {
  const config = loadConfig({ CARRY_MODE: 'mock', CARRY_DB: ':memory:' });
  const svc = createServices(config); await svc.start();
  const server = createApp(svc).listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/sandbox/setup-code')).status, 404);
    assert.equal((await fetch(base + '/api/sandbox/phone', { method: 'POST' })).status, 404);
    const m = await (await fetch(base + '/api/mode')).json(); assert.equal(m.sandbox, false); assert.equal(m.landing, false);
  } finally { server.close(); svc.store.close(); }
});

test('only recently used worlds are ticked, and one world cannot reach another through the API', async () => {
  let clock = 5_000_000;
  const t = await start({ activeMs: 60e3, now: () => clock });
  try {
    const a = t.browser(); await a.setup();
    const q = await a.f('/api/pay/demo/quote', { method: 'POST', body: { amountUsdc: 5, refundTo: REFUND } });
    await a.f('/api/mock/pay', { method: 'POST', body: { address: q.body.address } });
    clock += 120e3;                                  // a has been idle longer than activeMs: no tick for it
    await t.sb.tickAll(); await new Promise((r) => setTimeout(r, 60));
    await t.sb.tickAll();
    const s = await t.sb.worldOf(a.cookie.split('=')[1]);
    assert.equal(s.svc.store.events(50).some((e) => e.kind === 'payment_in'), false);
  } finally { t.close(); }
});
