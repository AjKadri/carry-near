// Home must not call a transient failure "not recognised": clock re-sync + one retry, a server-confirmed key check,
// a "retrying" message, and "Forget this browser's key" hidden behind More options with a confirm.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { boot } from './helpers.js';
import { createHomeClient, classifyRefusal, publicKeyFingerprint } from '../web/src/homeKey.js';

const out = path.resolve('node_modules/.cache/carry-test');
async function load(entry, name) {
  fs.mkdirSync(out, { recursive: true });
  const f = path.join(out, `${name}-${process.pid}.mjs`);
  await build({ entryPoints: [entry], outfile: f, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const m = await import(f); fs.rmSync(f, { force: true }); return m;
}
const subtle = webcrypto.subtle;
const newPair = () => subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
const spki = async (pair) => Buffer.from(await subtle.exportKey('spki', pair.publicKey)).toString('base64');
// a browser: its own key, its own (possibly wrong) clock, talking to the real server
async function browserFor(t, { skewMs = 0, pair } = {}) {
  pair ??= await newPair();
  const client = createHomeClient({ loadKey: async () => pair, fetchFn: (p, init) => t.raw(p, init), now: () => Date.now() + skewMs, subtle });
  return { pair, client };
}
const blocked = (t) => t.svc.store.events(200).filter((e) => e.kind === 'home_blocked');

test('a home request with a wrong clock re-syncs from the server and retries once with a fresh nonce: the page never sees the 401', async () => {
  const t = await boot({ register: false });
  try {
    const { pair, client } = await browserFor(t, { skewMs: 10 * 60e3 }); // this laptop's clock is 10 minutes fast
    assert.equal(t.svc.auth.register({ publicKeySpkiB64: await spki(pair), code: t.svc.auth.setupCode() }).ok, true);
    const r = await client.signedFetch('/api/home/state');
    assert.equal(r.status, 200); assert.equal(r.retried, true);
    assert.ok(Math.abs(client.offset + 10 * 60e3) < 2000, `offset ${client.offset} should cancel the 10 minute skew`);
    assert.deepEqual(blocked(t).map((e) => e.detail.reason), ['stale_timestamp']); // exactly the first attempt was refused; the retry was not a replay
    // the clock is now right, so the next request needs no retry
    const again = await client.signedFetch('/api/home/log'); assert.equal(again.status, 200); assert.equal(again.retried, undefined);
    assert.equal(blocked(t).length, 1);
  } finally { t.close(); }
});

test('a correct clock needs no retry; a refusal that survives the retry is returned after exactly two attempts', async () => {
  const t = await boot({ register: false });
  try {
    const good = await browserFor(t);
    t.svc.auth.register({ publicKeySpkiB64: await spki(good.pair), code: t.svc.auth.setupCode() });
    const ok = await good.client.signedFetch('/api/home/state'); assert.equal(ok.status, 200); assert.equal(ok.retried, undefined); assert.equal(blocked(t).length, 0);
    const stranger = await browserFor(t); // a different key: refused, retried once, refused again
    const bad = await stranger.client.signedFetch('/api/home/state');
    assert.equal(bad.status, 401); assert.equal(bad.retried, true);
    assert.deepEqual(blocked(t).map((e) => e.detail.reason), ['bad_signature', 'bad_signature']);
  } finally { t.close(); }
});

test('"not recognised" needs the server to say so: the status answer compares this browser\'s key with the registered one', async () => {
  const t = await boot({ register: false });
  try {
    const mine = await browserFor(t), other = await browserFor(t);
    // nothing registered yet
    assert.deepEqual(await mine.client.keyStatus(), { registered: false, matches: null });
    t.svc.auth.register({ publicKeySpkiB64: await spki(mine.pair), code: t.svc.auth.setupCode() });
    assert.deepEqual(await mine.client.keyStatus(), { registered: true, matches: true });
    assert.deepEqual(await other.client.keyStatus(), { registered: true, matches: false });
    const j = await (await t.raw('/api/home/auth/status')).json();
    assert.equal(j.registered, true); assert.equal(j.matches, null); assert.ok(Math.abs(j.serverTime - Date.now()) < 2000);
    assert.equal((await (await t.raw('/api/home/auth/status?key=zzz')).json()).matches, null); // junk is ignored
    assert.equal(await publicKeyFingerprint(mine.pair, subtle), t.svc.auth.fingerprint());
    // the decision
    assert.equal(classifyRefusal({ registered: true, matches: false }), 'unrecognised');
    assert.equal(classifyRefusal({ registered: false, matches: null }), 'unrecognised');
    assert.equal(classifyRefusal({ registered: true, matches: true }), 'retry');   // our key is the right one: the refusal was something else
    assert.equal(classifyRefusal(null), 'retry');                                   // the server could not be asked: do not conclude anything
    assert.equal(classifyRefusal(undefined), 'retry');
  } finally { t.close(); }
});

test('a transient failure (server unreachable) is status 0, never a thrown error, never "not recognised"', async () => {
  const pair = await newPair();
  const client = createHomeClient({ loadKey: async () => pair, fetchFn: async () => { throw new TypeError('network down'); }, subtle });
  const r = await client.signedFetch('/api/home/state');
  assert.equal(r.status, 0);
  assert.equal(await client.keyStatus(), null);
  assert.equal(classifyRefusal(await client.keyStatus()), 'retry');
});

test('"Couldn\'t reach your home controls, retrying…" shows only while there is a problem', async () => {
  const { HomeLinkBanner } = await load('web/src/gate.jsx', 'gate1');
  assert.match(renderToStaticMarkup(React.createElement(HomeLinkBanner, { problem: true })), /Couldn&#x27;t reach your home controls, retrying…/);
  assert.equal(renderToStaticMarkup(React.createElement(HomeLinkBanner, { problem: false })), '');
});

test('"Forget this browser\'s key" is hidden behind "More options" and needs a confirm that says what it does', async () => {
  const { Unrecognised, forgetWithConfirm, FORGET_WARNING } = await load('web/src/gate.jsx', 'gate2');
  const html = renderToStaticMarkup(React.createElement(Unrecognised, { onRetry() {}, onForget() {} }));
  assert.match(html, /More options/); assert.match(html, /Try again/);
  assert.equal(html.includes("Forget this browser's key"), false, 'not offered up front');
  assert.match(FORGET_WARNING, /locks this device out/); assert.match(FORGET_WARNING, /reset-home-key/);
  let cleared = 0, after = 0;
  assert.equal(await forgetWithConfirm({ confirmFn: () => false, clearKey: async () => { cleared++; }, after: async () => { after++; } }), false);
  assert.deepEqual([cleared, after], [0, 0]);                                       // "Cancel": nothing is forgotten
  let asked = ''; 
  assert.equal(await forgetWithConfirm({ confirmFn: (m) => { asked = m; return true; }, clearKey: async () => { cleared++; }, after: async () => { after++; } }), true);
  assert.deepEqual([cleared, after], [1, 1]); assert.equal(asked, FORGET_WARNING);
});

test('Home asks the server before it says "not recognised", and every API answer is no-store', async () => {
  const app = fs.readFileSync('web/src/App.jsx', 'utf8');
  assert.equal(/status === 401\) onUnrecognised\(\)/.test(app), false, 'a bare 401 must not flip the page to "not recognised"');
  assert.match(app, /keyStatus\(\)\.then\(\(k\) => \{ if \(classifyRefusal\(k\) === 'unrecognised'\) onUnrecognised\(\)/);
  const t = await boot();
  try {
    for (const p of ['/api/mode', '/api/home/auth/status', '/api/phone/state', '/api/pay/demo', '/api/health']) {
      const r = await t.raw(p); assert.equal(r.headers.get('cache-control'), 'no-store', p);
    }
  } finally { t.close(); }
});
