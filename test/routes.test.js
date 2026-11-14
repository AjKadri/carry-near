import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';
import { makeTestDevice } from '../server/homeauth.js';
import { MOCK_LANDLORD, MOCK_POCKET_KEY } from '../server/mock.js';

const snapshot = (t) => JSON.stringify({ bills: t.svc.store.bills(), allowance: String(t.svc.store.allowance()) });
const blocked = (t) => t.svc.store.events(200).filter((e) => e.kind === 'home_blocked');

test('home routes without the device key: bare 401, nothing changes, and every attempt is in the home log as blocked', async () => {
  const t = await boot({ allowance: 5_000_000 });
  try {
    t.svc.store.createBill({ id: 'rent', label: 'rent', payee: MOCK_LANDLORD, amount: 15_000_000, expiresAt: Date.now() + 3600e3 });
    const before = snapshot(t);
    const phone = { Authorization: `Bearer ${MOCK_POCKET_KEY}` };
    const attempts = [
      ['POST', '/api/home/bills', { id: 'evil', label: 'x', payee: 'evil.near', amountUsdc: 1, expiresAt: '2030-01-01T00:00:00Z' }],
      ['PUT', '/api/home/bills/rent', { label: 'x', payee: 'evil.near', amountUsdc: 99, expiresAt: '2030-01-01T00:00:00Z' }],
      ['DELETE', '/api/home/bills/rent'], ['POST', '/api/home/allowance', { totalUsdc: 9999 }], ['POST', '/api/home/engine/clear-halt'],
      ['POST', '/api/home/exit', { amountUsdc: 1 }], ['GET', '/api/home/state'], ['GET', '/api/home/log'], ['POST', '/api/home/pair/start'], ['GET', '/api/home/does-not-exist'],
    ];
    for (const [method, path, body] of attempts) {
      const r = await t.raw(path, { method, headers: { 'Content-Type': 'application/json', ...phone }, body: body ? JSON.stringify(body) : undefined });
      assert.equal(r.status, 401, `${method} ${path}`);
      assert.equal(await r.text(), '{"error":"unauthorized"}');
    }
    assert.equal(snapshot(t), before);
    assert.equal(blocked(t).length, attempts.length);
    assert.equal(blocked(t)[0].ok, false);
    assert.ok(blocked(t).every((e) => e.detail.reason === 'missing_or_malformed_headers'));
    assert.equal(t.svc.mock.reqs.size, 0); // /exit never reached OutLayer
  } finally { t.close(); }
});

test('the same writes work with the laptop key, so the 401s above are about the signature', async () => {
  const t = await boot({ allowance: 0 });
  try {
    assert.equal((await t.hj('/api/home/allowance', { method: 'POST', body: { totalUsdc: 12 } })).status, 200);
    assert.equal(t.svc.store.allowance(), 12_000_000n);
    assert.equal((await t.hj('/api/home/bills', { method: 'POST', body: { id: 'rent', label: 'rent', payee: MOCK_LANDLORD, amountUsdc: 15, expiresAt: '2030-01-01T00:00:00Z' } })).status, 200);
    assert.equal(t.svc.store.bills()[0].amount, '15000000');
    assert.equal(blocked(t).length, 0);
  } finally { t.close(); }
});

test('signed request: tampered body, tampered path, replay, stale and future timestamps, other device, are all refused and logged', async () => {
  const t = await boot({ allowance: 5_000_000 });
  try {
    const body = { totalUsdc: 1 }, raw = JSON.stringify(body);
    const sig = t.device.sign({ method: 'POST', path: '/api/home/allowance', body: raw });
    const send = (path, b, h) => t.j(t.pub, path, { method: 'POST', body: b, headers: h });
    // tampered body: valid signature for totalUsdc 1, body says 9999
    assert.equal((await send('/api/home/allowance', JSON.stringify({ totalUsdc: 9999 }), sig)).status, 401);
    // tampered path (query appended)
    assert.equal((await send('/api/home/allowance?x=1', raw, sig)).status, 401);
    // wrong method
    assert.equal((await t.j(t.pub, '/api/home/allowance', { method: 'PUT', body: raw, headers: sig })).status, 401);
    assert.equal(t.svc.store.allowance(), 5_000_000n);
    // genuine request succeeds once...
    assert.equal((await send('/api/home/allowance', raw, sig)).status, 200);
    assert.equal(t.svc.store.allowance(), 1_000_000n);
    // ...and the exact same bytes replayed are refused
    t.svc.store.setAllowance(5_000_000n);
    assert.equal((await send('/api/home/allowance', raw, sig)).status, 401);
    assert.equal(t.svc.store.allowance(), 5_000_000n);
    // stale (61 s old) and future (61 s ahead) timestamps
    for (const skew of [-61_000, 61_000]) {
      const s = t.device.sign({ method: 'POST', path: '/api/home/allowance', body: raw, time: Date.now() + skew });
      assert.equal((await send('/api/home/allowance', raw, s)).status, 401);
    }
    // 30 s old is still accepted (inside the 60 s window)
    assert.equal((await send('/api/home/allowance', raw, t.device.sign({ method: 'POST', path: '/api/home/allowance', body: raw, time: Date.now() - 30_000 }))).status, 200);
    // a different device key
    const other = makeTestDevice();
    assert.equal((await send('/api/home/allowance', raw, other.sign({ method: 'POST', path: '/api/home/allowance', body: raw }))).status, 401);
    const reasons = blocked(t).map((e) => e.detail.reason);
    for (const want of ['bad_signature', 'replayed_nonce', 'stale_timestamp']) assert.ok(reasons.includes(want), `${want} not logged: ${reasons}`);
  } finally { t.close(); }
});

test('device setup: needs the console code, works once, wrong codes are limited, only an ECDSA P-256 key is accepted', async () => {
  const t = await boot({ register: false });
  try {
    const dev = makeTestDevice();
    assert.equal((await t.j(t.pub, '/api/home/auth/status')).body.registered, false);
    assert.equal((await t.hj('/api/home/state')).status, 401); // nothing works before setup
    assert.equal((await t.j(t.pub, '/api/home/auth/setup', { method: 'POST', body: { publicKey: dev.publicKeySpkiB64, setupCode: 'WRONGWRONG' } })).status, 403);
    const code = t.svc.auth.setupCode();
    const rsa = (await import('node:crypto')).generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    assert.equal((await t.j(t.pub, '/api/home/auth/setup', { method: 'POST', body: { publicKey: rsa, setupCode: code } })).status, 400);
    assert.equal((await t.j(t.pub, '/api/home/auth/setup', { method: 'POST', body: { publicKey: dev.publicKeySpkiB64, setupCode: code } })).status, 200);
    assert.equal((await t.j(t.pub, '/api/home/auth/setup', { method: 'POST', body: { publicKey: makeTestDevice().publicKeySpkiB64, setupCode: code } })).status, 409); // cannot replace
    assert.equal(t.svc.auth.setupCode(), null);
  } finally { t.close(); }
  const t2 = await boot({ register: false });
  try {
    const dev = makeTestDevice();
    for (let i = 0; i < 5; i++) assert.equal((await t2.j(t2.pub, '/api/home/auth/setup', { method: 'POST', body: { publicKey: dev.publicKeySpkiB64, setupCode: 'NOPENOPENO' } })).status, 403);
    assert.equal((await t2.j(t2.pub, '/api/home/auth/setup', { method: 'POST', body: { publicKey: dev.publicKeySpkiB64, setupCode: t2.svc.auth.setupCode() } })).status, 429); // even the right code, after 5 misses
  } finally { t2.close(); }
});

test('pairing: laptop starts, phone claims, both see the same code, the phone gets only its pocket credential, once, after laptop confirmation', async () => {
  const t = await boot();
  try {
    const s = (await t.hj('/api/home/pair/start', { method: 'POST' })).body;
    assert.ok(s.id && s.secret);
    // wrong secret
    assert.equal((await t.j(t.pub, '/api/pair/claim', { method: 'POST', body: { id: s.id, secret: 'nope' } })).status, 403);
    // the phone polls before claiming: no credential
    const early = await t.j(t.pub, `/api/pair/${s.id}/result`, { headers: { 'X-Pair-Secret': s.secret } });
    assert.equal(early.body.pocketKey, undefined);
    const claim = await t.j(t.pub, '/api/pair/claim', { method: 'POST', body: { id: s.id, secret: s.secret } });
    assert.equal(claim.status, 200); assert.match(claim.body.code, /^\d{6}$/);
    assert.equal((await t.j(t.pub, '/api/pair/claim', { method: 'POST', body: { id: s.id, secret: s.secret } })).status, 409); // second claim refused
    const laptop = (await t.hj(`/api/home/pair/${s.id}`)).body;
    assert.equal(laptop.state, 'claimed'); assert.equal(laptop.code, claim.body.code); // the same code on both screens
    // still no credential before the laptop confirms
    assert.equal((await t.j(t.pub, `/api/pair/${s.id}/result`, { headers: { 'X-Pair-Secret': s.secret } })).body.pocketKey, undefined);
    // an unsigned confirm does nothing
    assert.equal((await t.j(t.pub, `/api/home/pair/${s.id}/confirm`, { method: 'POST' })).status, 401);
    assert.equal((await t.hj(`/api/home/pair/${s.id}/confirm`, { method: 'POST' })).body.ok, true);
    const got = await t.j(t.pub, `/api/pair/${s.id}/result`, { headers: { 'X-Pair-Secret': s.secret } });
    assert.equal(got.body.pocketKey, MOCK_POCKET_KEY);
    assert.deepEqual(Object.keys(got.body).sort(), ['pocketAccount', 'pocketKey', 'state']); // nothing else
    assert.equal((await t.j(t.pub, `/api/pair/${s.id}/result`, { headers: { 'X-Pair-Secret': s.secret } })).status, 404); // once only
    assert.equal(JSON.stringify(t.svc.store.events(100)).includes(MOCK_POCKET_KEY), false);
  } finally { t.close(); }
});

test('exit: signed request creates a pending withdrawal to the exit account; the guard would never approve it', async () => {
  const t = await boot({ allowance: 0 });
  try {
    t.svc.mock.credit(5_000_000);
    const r = await t.hj('/api/home/exit', { method: 'POST', body: { amountUsdc: 1 } });
    assert.equal(r.status, 200); assert.equal(r.body.status, 'pending_approval');
    await t.settleAll(4);
    assert.equal(t.svc.mock.bal.reserve, 5_000_000n); // nothing moved without the owner
    assert.ok([...t.svc.mock.approvals.values()].every((a) => a.status === 'pending'));
  } finally { t.close(); }
});

test('phone API: key required, never stored; refusals returned raw; reserve never exposed; bare 401 for a missing or wrong key', async () => {
  const t = await boot({ allowance: 0 });
  try {
    t.svc.mock.bal.pocket = 8_000_000n;
    const over = await t.j(t.pub, '/api/phone/send', { method: 'POST', headers: { Authorization: `Bearer ${MOCK_POCKET_KEY}` }, body: { to: MOCK_LANDLORD, amountUsdc: 11 } });
    assert.equal(over.status, 403); assert.match(over.body.message, /Per-transaction limit exceeded/);
    assert.equal(JSON.stringify(t.svc.store.events(100)).includes(MOCK_POCKET_KEY), false);
    for (const [method, path, headers, b] of [['GET', '/api/phone/state', undefined, undefined], ['GET', '/api/phone/state', { Authorization: 'Bearer wk_wrong' }, undefined], ['GET', '/api/phone/state', { Authorization: 'Basic abc' }, undefined], ['POST', '/api/phone/send', undefined, { to: MOCK_LANDLORD, amountUsdc: 1 }], ['POST', '/api/phone/send', { Authorization: 'Bearer wk_wrong' }, { to: MOCK_LANDLORD, amountUsdc: 1 }]]) {
      const r = await fetch(t.pub + path, { method, headers: { 'Content-Type': 'application/json', ...(headers ?? {}) }, body: b ? JSON.stringify(b) : undefined });
      assert.equal(r.status, 401); assert.equal(await r.text(), '{"error":"unauthorized"}');
    }
    const ok = await t.j(t.pub, '/api/phone/state', { headers: { Authorization: `Bearer ${MOCK_POCKET_KEY}` } });
    assert.equal(ok.body.pocket, 8_000_000); assert.equal('reserve' in ok.body, false);
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
    assert.equal((await t.j(t.pub, `/api/pay/demo/status?address=${a.body.address}`)).body.status, 'PENDING_DEPOSIT');
    assert.equal((await t.j(t.pub, '/api/pay/demo/status?address=unknown')).status, 404);
  } finally { t.close(); }
});

test('security headers are set (CSP limits script to the app itself)', async () => {
  const t = await boot();
  try {
    const r = await fetch(t.pub + '/api/health');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
  } finally { t.close(); }
});
