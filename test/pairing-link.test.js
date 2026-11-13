import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot } from './helpers.js';
import { MOCK_POCKET_KEY } from '../server/mock.js';

// The "pairing link" on Home must be no weaker than the QR code. These tests pin each property.
const hdr = (secret) => ({ headers: { 'X-Pair-Secret': secret } });
const read = (f) => fs.readFileSync(f, 'utf8');

test('link = QR: one address (id + one-time secret) is built once and used for both; same session, same 5-minute expiry', async () => {
  const app = read('web/src/App.jsx');
  assert.equal((app.match(/\/pair\/\$\{s\.id\}#\$\{s\.secret\}/g) ?? []).length, 1, 'the pairing address is built in exactly one place');
  assert.match(app, /QRCode\.toCanvas\(canvas\.current, pairUrl,/);
  assert.match(app, /href=\{pairUrl\}/);
  // server side: the session carries ONE expiry; the view the laptop sees reports it, and claiming after it fails
  let t0 = Date.now(); const clock = () => t0;
  const t = await boot({ now: clock, mockOpts: { now: clock } });
  try {
    const s = (await t.hj('/api/home/pair/start', { method: 'POST' })).body;
    assert.equal(s.expiresAt - t0, 5 * 60e3);
    assert.equal((await t.hj(`/api/home/pair/${s.id}`)).body.expiresAt, s.expiresAt);
    t0 += 5 * 60e3 + 1000; // the link and the QR die together
    assert.equal((await t.j(t.pub, '/api/pair/claim', { method: 'POST', body: { id: s.id, secret: s.secret } })).status, 404);
    assert.equal((await t.hj(`/api/home/pair/${s.id}`)).body.state, 'expired');
  } finally { t.close(); }
});

test('the pairing token can be claimed once only; guessing is limited', async () => {
  const t = await boot();
  try {
    const s = (await t.hj('/api/home/pair/start', { method: 'POST' })).body;
    const claim = (secret) => t.j(t.pub, '/api/pair/claim', { method: 'POST', body: { id: s.id, secret } });
    assert.equal((await claim(s.secret)).status, 200);
    assert.equal((await claim(s.secret)).status, 409);            // second claim of the same token
    const s2 = (await t.hj('/api/home/pair/start', { method: 'POST' })).body;
    for (let i = 0; i < 5; i++) assert.equal((await t.j(t.pub, '/api/pair/claim', { method: 'POST', body: { id: s2.id, secret: 'guess' + i } })).status, 403);
    assert.equal((await t.j(t.pub, '/api/pair/claim', { method: 'POST', body: { id: s2.id, secret: s2.secret } })).status, 429); // locked after 5 wrong tries
  } finally { t.close(); }
});

test('no credential is issued until the laptop confirms; confirm is signed and only works after a claim', async () => {
  const t = await boot();
  try {
    const s = (await t.hj('/api/home/pair/start', { method: 'POST' })).body;
    assert.equal((await t.hj(`/api/home/pair/${s.id}/confirm`, { method: 'POST' })).body.ok, false); // nothing claimed yet
    const claim = (await t.j(t.pub, '/api/pair/claim', { method: 'POST', body: { id: s.id, secret: s.secret } })).body;
    assert.match(claim.code, /^\d{6}$/);
    assert.equal((await t.hj(`/api/home/pair/${s.id}`)).body.code, claim.code); // laptop shows the same code to compare
    const before = (await t.j(t.pub, `/api/pair/${s.id}/result`, hdr(s.secret))).body;
    assert.equal(before.pocketKey, undefined); assert.equal(before.state, 'claimed');
    assert.equal((await t.j(t.pub, `/api/home/pair/${s.id}/confirm`, { method: 'POST' })).status, 401); // the phone cannot confirm itself
    assert.equal((await t.hj(`/api/home/pair/${s.id}/confirm`, { method: 'POST' })).body.ok, true);
    assert.equal((await t.j(t.pub, `/api/pair/${s.id}/result`, hdr(s.secret))).body.pocketKey, MOCK_POCKET_KEY);
  } finally { t.close(); }
});

test('the link is rendered only on Home: pairing control routes need the home key, and no phone or shared file builds a pairing address', async () => {
  const t = await boot();
  try {
    for (const [m, p] of [['POST', '/api/home/pair/start'], ['GET', '/api/home/pair/abc'], ['POST', '/api/home/pair/abc/confirm'], ['POST', '/api/home/pair/abc/cancel']]) {
      const r = await t.j(t.pub, p, { method: m });
      assert.equal(r.status, 401, `${m} ${p} unsigned`); assert.deepEqual(r.body, { error: 'unauthorized' });
    }
  } finally { t.close(); }
  const app = read('web/src/App.jsx');
  const panel = app.slice(app.indexOf('function PairPanel'), app.indexOf('// The latest arrival'));
  assert.ok(panel.includes('href={pairUrl}'));
  assert.equal(app.replace(panel, '').includes('pairUrl'), false, 'pairUrl exists only inside PairPanel');
  assert.equal((app.match(/<PairPanel\s*\/>/g) ?? []).length, 1);
  const homeApp = app.slice(app.indexOf('function HomeApp'));
  assert.ok(homeApp.includes('<PairPanel />'), 'PairPanel is rendered only inside HomeApp (behind the home key gate)');
  for (const f of ['web/src/phone.jsx', 'web/src/parts.jsx', 'web/src/motion.js', 'web/src/api.js']) assert.equal(/pair\/\$\{|pairUrl/.test(read(f)), false, f);
});

test('the pairing secret never appears in server logs, events or console output, and is not accepted in a URL', async () => {
  const out = []; const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => out.push(a.map(String).join(' '));
  const t = await boot();
  try {
    const s = (await t.hj('/api/home/pair/start', { method: 'POST' })).body;
    await t.j(t.pub, '/api/pair/claim', { method: 'POST', body: { id: s.id, secret: 'wrong' + s.secret.slice(0, 5) } });
    await t.j(t.pub, '/api/pair/claim', { method: 'POST', body: { id: s.id, secret: s.secret } });
    await t.hj(`/api/home/pair/${s.id}/confirm`, { method: 'POST' });
    assert.equal((await t.j(t.pub, `/api/pair/${s.id}/result?secret=${s.secret}`)).status, 403, 'a secret in the URL is not accepted');
    assert.equal((await t.j(t.pub, `/api/pair/${s.id}/result`, hdr(s.secret))).body.pocketKey, MOCK_POCKET_KEY);
    const events = JSON.stringify(t.svc.store.events(500));
    assert.equal(events.includes(s.secret), false, 'events');
    assert.equal(out.join('\n').includes(s.secret), false, 'console');
    assert.equal(events.includes(s.id), false, 'not even the session id is logged');
  } finally { Object.assign(console, orig); t.close(); }
  // and the server code has no access logger, and the frontend never puts the secret in a fetch URL
  assert.equal(/morgan|app\.use\(\(req[^)]*\)\s*=>\s*\{?\s*console/.test(read('server/app.js')), false);
  assert.equal(/result\?secret/.test(read('web/src/App.jsx')), false);
});
