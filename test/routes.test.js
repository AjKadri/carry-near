import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { boot } from './helpers.js';
import { createHomeApp } from '../server/app.js';
import { MOCK_LANDLORD, MOCK_POCKET_KEY } from '../server/mock.js';

const snapshot = (t) => JSON.stringify({ bills: t.svc.store.bills(), allowance: String(t.svc.store.allowance()) });

test('phone/public app cannot create or edit a bill or raise the allowance; guard state unchanged', async () => {
  const t = await boot({ allowance: 5_000_000 });
  try {
    t.svc.store.createBill({ id: 'rent', label: 'rent', payee: MOCK_LANDLORD, amount: 15_000_000, expiresAt: Date.now() + 3600e3 });
    const before = snapshot(t);
    const auth = { Authorization: `Bearer ${MOCK_POCKET_KEY}` };
    const attempts = [
      ['POST', '/api/home/bills', { id: 'evil', label: 'x', payee: 'evil.near', amountUsdc: 1, expiresAt: '2030-01-01T00:00:00Z' }],
      ['PUT', '/api/home/bills/rent', { label: 'x', payee: 'evil.near', amountUsdc: 99, expiresAt: '2030-01-01T00:00:00Z' }],
      ['DELETE', '/api/home/bills/rent'],
      ['POST', '/api/home/allowance', { totalUsdc: 9999 }],
      ['POST', '/api/phone/bills', { id: 'evil', payee: 'evil.near', amountUsdc: 1 }],
      ['PUT', '/api/phone/bills/rent', { amountUsdc: 99 }],
      ['POST', '/api/phone/allowance', { totalUsdc: 9999 }],
      ['GET', '/api/home/state'],
    ];
    for (const [method, path, body] of attempts) {
      const r = await t.j(t.pub, path, { method, headers: auth, body });
      assert.ok([404, 405].includes(r.status) || r.status === 400, `${method} ${path} -> ${r.status}`);
      assert.notEqual(r.status, 200, `${method} ${path} must not succeed`);
    }
    assert.equal(snapshot(t), before);
  } finally { t.close(); }
});

test('the same writes DO work on the home app (so the refusals above are about the route, not a broken test)', async () => {
  const t = await boot({ allowance: 0 });
  try {
    assert.equal((await t.j(t.home, '/api/home/allowance', { method: 'POST', body: { totalUsdc: 12 } })).status, 200);
    assert.equal(t.svc.store.allowance(), 12_000_000n);
    assert.equal((await t.j(t.home, '/api/home/bills', { method: 'POST', body: { id: 'rent', label: 'rent', payee: MOCK_LANDLORD, amountUsdc: 15, expiresAt: '2030-01-01T00:00:00Z' } })).status, 200);
    assert.equal(t.svc.store.bills()[0].amount, '15000000');
  } finally { t.close(); }
});

test('home routes refuse a non-loopback connection', async () => {
  const t = await boot({ allowance: 5_000_000 });
  try {
    const app = createHomeApp(t.svc);
    const sock = new net.Socket(); Object.defineProperty(sock, 'remoteAddress', { value: '10.1.2.3' });
    const req = new http.IncomingMessage(sock);
    Object.assign(req, { method: 'POST', url: '/api/home/allowance', headers: { 'content-type': 'application/json' } });
    const body = JSON.stringify({ totalUsdc: 9999 }); req.push(body); req.push(null);
    const res = new http.ServerResponse(req); const chunks = [];
    const done = new Promise((r) => { res.write = (c) => { chunks.push(c); return true; }; res.end = (c) => { if (c) chunks.push(c); r(); return res; }; });
    app.handle(req, res); await done;
    assert.equal(res.statusCode, 403);
    assert.match(String(chunks.join('')), /home_only/);
    assert.equal(t.svc.store.allowance(), 5_000_000n);
  } finally { t.close(); }
});

test('phone API: key required, never stored; refusals returned raw; reserve never exposed', async () => {
  const t = await boot({ allowance: 0 });
  try {
    t.svc.mock.bal.pocket = 8_000_000n;
    assert.equal((await t.j(t.pub, '/api/phone/state')).status, 401);
    const over = await t.j(t.pub, '/api/phone/send', { method: 'POST', headers: { Authorization: `Bearer ${MOCK_POCKET_KEY}` }, body: { to: MOCK_LANDLORD, amountUsdc: 11 } });
    assert.equal(over.status, 403); assert.match(over.body.message, /Per-transaction limit exceeded/);
    const log = JSON.stringify(t.svc.store.events(100));
    assert.equal(log.includes(MOCK_POCKET_KEY), false);
    assert.ok(t.svc.store.events(100).some((e) => e.kind === 'phone_send_refused'));
    const wrongKey = await t.j(t.pub, '/api/phone/state', { headers: { Authorization: 'Bearer wk_notmine' } });
    assert.equal(wrongKey.status, 401);
  } finally { t.close(); }
});

test('pay link: unknown handle 404, bad refund address 400, same payer+amount reuses the address, amount bounds', async () => {
  const t = await boot({ allowance: 0 });
  try {
    assert.equal((await t.j(t.pub, '/api/pay/nope')).status, 404);
    assert.equal((await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { amountUsdc: 5, refundTo: 'not-an-address' } })).status, 400);
    for (const amountUsdc of [0, -1, 0.01, 'x', 1e9]) assert.equal((await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { amountUsdc, refundTo: '7puyGCiSnh55z3EzWEr8MKDBw9FYH2izq4K4mXPNpcuo' } })).status, 400);
    const a = await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { amountUsdc: 5, refundTo: '7puyGCiSnh55z3EzWEr8MKDBw9FYH2izq4K4mXPNpcuo' } });
    const b = await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { amountUsdc: 5, refundTo: '7puyGCiSnh55z3EzWEr8MKDBw9FYH2izq4K4mXPNpcuo' } });
    assert.equal(a.body.address, b.body.address);
    const st = await t.j(t.pub, `/api/pay/demo/status?address=${a.body.address}`);
    assert.equal(st.body.status, 'PENDING_DEPOSIT');
    assert.equal((await t.j(t.pub, '/api/pay/demo/status?address=unknown')).status, 404);
  } finally { t.close(); }
});

test('phone routes: a missing or wrong key gets 401 {"error":"unauthorized"} and nothing else', async () => {
  const t = await boot({ allowance: 0 });
  try {
    const body = { to: MOCK_LANDLORD, amountUsdc: 1 };
    const cases = [
      ['GET', '/api/phone/state', undefined, undefined],
      ['GET', '/api/phone/state', { Authorization: 'Bearer wk_wrong' }, undefined],
      ['GET', '/api/phone/state', { Authorization: 'Basic abc' }, undefined],
      ['POST', '/api/phone/send', undefined, body],
      ['POST', '/api/phone/send', { Authorization: 'Bearer wk_wrong' }, body],
    ];
    for (const [method, path, headers, b] of cases) {
      const r = await fetch(t.pub + path, { method, headers: { 'Content-Type': 'application/json', ...(headers ?? {}) }, body: b ? JSON.stringify(b) : undefined });
      assert.equal(r.status, 401, `${method} ${path}`);
      assert.equal(await r.text(), '{"error":"unauthorized"}', `${method} ${path} body must carry no detail`);
    }
    assert.equal(t.svc.mock.bal.pocket, 0n);
  } finally { t.close(); }
});
