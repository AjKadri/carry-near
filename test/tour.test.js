// The sandbox's guided tour: ticks come from real events, no "Mock:" wording, the phone hint and the simulated withdrawal are sandbox-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSandbox, COOKIE } from '../server/sandbox.js';
import { createMock, MOCK_EXIT, MOCK_LANDLORD } from '../server/mock.js';
import { makeTestDevice } from '../server/homeauth.js';

const out = path.resolve('node_modules/.cache/carry-test');
async function load(entry, name) {
  fs.mkdirSync(out, { recursive: true });
  const f = path.join(out, `${name}-${process.pid}.mjs`);
  await build({ entryPoints: [entry], outfile: f, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const m = await import(f); fs.rmSync(f, { force: true }); return m;
}
const ev = (kind) => ({ id: 1, kind, ok: true, amount: null, detail: {}, ts: '2026-11-14T16:00:00.000Z' });
const ticks = (html) => [...html.matchAll(/data-done="(true|false)"/g)].map((m) => m[1] === 'true');

test('each step is ticked only by the real event that proves it', async () => {
  const { SandboxTour, tourState } = await load('web/src/tour.jsx', 'tour1');
  const render = (events) => renderToStaticMarkup(React.createElement(SandboxTour, { events, busy: '', note: '', onPay() {}, onPhone() {}, onRent() {} }));
  assert.deepEqual(ticks(render([])), [false, false, false, false]);
  assert.deepEqual(ticks(render([ev('payment_in')])), [true, false, false, false]);
  assert.deepEqual(ticks(render([ev('pair_confirmed')])), [false, true, false, false]);
  assert.deepEqual(ticks(render([ev('phone_send_refused')])), [false, false, true, false]);
  assert.deepEqual(ticks(render([ev('bill_created')])), [false, false, false, false]); // saved is not paid
  assert.deepEqual(ticks(render([ev('bill_paid')])), [false, false, false, true]);
  assert.deepEqual(ticks(render(['payment_in', 'pair_confirmed', 'phone_send_refused', 'bill_created', 'bill_paid'].map(ev))), [true, true, true, true]);
  // a normal phone send or a refusal of a bill is not the proof either
  assert.deepEqual(ticks(render([ev('phone_send'), ev('bill_refused'), ev('pair_started'), ev('refill_skipped')])), [false, false, false, false]);
  assert.equal(tourState([ev('bill_created')]).rentSaved, true);
  const html = render([]);
  for (const t of ['Simulate a client payment (5 USDC)', 'Open the phone view', 'On the phone, try to send 500', 'Pay the rent from the phone']) assert.ok(html.includes(t), t);
  assert.equal(/Mock/i.test(html), false, 'no "Mock" in the tour');
  assert.match(render(['payment_in', 'pair_confirmed', 'phone_send_refused', 'bill_paid'].map(ev)), /All four done/);
});

test('"Mock:" appears in the web app only where the sandbox is excluded', () => {
  for (const f of fs.readdirSync('web/src').filter((n) => /\.(jsx?|css)$/.test(n))) {
    const text = fs.readFileSync(`web/src/${f}`, 'utf8');
    for (const m of text.matchAll(/Mock: simulate this payment/g)) {
      const before = text.slice(Math.max(0, m.index - 120), m.index);
      assert.match(before, /sandbox \? 'Simulate this payment' : '$/, `${f}: "Mock: simulate this payment" must be the non-sandbox branch of a ternary`);
    }
    if (f !== 'App.jsx') assert.equal(/Mock:/.test(text), false, `${f} must not say "Mock:"`);
  }
  const app = fs.readFileSync('web/src/App.jsx', 'utf8');
  assert.match(app, /sandbox \? <SandboxBanner/); // the sandbox banner replaces the "Mock mode: ..." one
});

test('the phone hint is shown only when given (the sandbox), and the form is filled in only in the sandbox', async () => {
  const { PhoneView } = await load('web/src/phone.jsx', 'phone-hint');
  const base = { status: 'ok', pocket: 3_000_000, ceiling: 20_000_000, sendLimit: 10_000_000, bills: [], flipIds: new Set(), split: 0, tiles: [], res: null, to: '', setTo() {}, amt: '1', setAmt() {}, sending: false, onSend() {}, onPay() {} };
  assert.match(renderToStaticMarkup(React.createElement(PhoneView, { ...base, hint: 'Try sending 500, it will be blocked' })), /Try sending 500, it will be blocked/);
  assert.equal(/Try sending 500/.test(renderToStaticMarkup(React.createElement(PhoneView, base))), false);
  const src = fs.readFileSync('web/src/phone.jsx', 'utf8');
  assert.match(src, /hint=\{sandbox \? 'Try sending 500, it will be blocked' : undefined\}/);
  assert.match(src, /if \(sandbox\) \{ setTo\(/);
});

test('mock: the owner\'s approval of a withdrawal works only for a pending withdrawal to the exit account', async () => {
  let t = 1_000_000;
  const m = createMock({ now: () => t, settleDelayMs: 10 });
  m.credit(50_000_000);
  const w = await m.transport('reserve', 'POST', '/wallet/v1/confidential/withdraw', { to: MOCK_EXIT, amount: '2000000', token: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', chain: 'near' }, {});
  assert.equal(w.status, 200); assert.equal(w.body.status, 'pending_approval');
  const before = m.bal.reserve;
  assert.equal(m.adminApprove('nope'), false);
  assert.equal(m.adminApprove(w.body.request_id), true);
  assert.equal(m.adminApprove(w.body.request_id), false); // only once
  t += 100;
  const r = await m.transport('reserve', 'GET', `/wallet/v1/requests/${w.body.request_id}`);
  assert.equal(r.body.status, 'success'); assert.equal(m.bal.reserve, before - 2_000_000n);
  // a withdrawal to anywhere else (the landlord, a bill) is never approved this way
  const bill = await m.transport('reserve', 'POST', '/wallet/v1/confidential/withdraw', { to: MOCK_LANDLORD, amount: '1000000', token: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', chain: 'near' }, {});
  assert.equal(bill.status, 200); assert.equal(m.adminApprove(bill.body.request_id), false);
});

test('sandbox API: the tour sample, the simulated withdrawal approval (own world only)', async () => {
  const sb = createSandbox({ mockOpts: { settleDelayMs: 10 }, settleOpts: { intervalMs: 10, timeoutMs: 3000 }, perIpPerHour: 1000, tickMs: 50 });
  const server = sb.handler.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = () => {
    let ck = ''; const device = makeTestDevice();
    const f = async (p, init = {}) => { const r = await fetch(base + p, { ...init, headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}), ...(init.headers ?? {}) }, body: init.body && typeof init.body !== 'string' ? JSON.stringify(init.body) : init.body }); for (const c of r.headers.getSetCookie?.() ?? []) { const m = new RegExp(`^(${COOKIE}=[^;]+)`).exec(c); if (m) ck = m[1]; } return { status: r.status, body: await r.json().catch(() => null) }; };
    const signed = (p, { method = 'GET', body } = {}) => { const raw = body === undefined ? '' : JSON.stringify(body); return f(p, { method, body: raw || undefined, headers: device.sign({ method, path: p, body: raw, time: Date.now() }) }); };
    return { f, signed, device, setup: async () => f('/api/home/auth/setup', { method: 'POST', body: { publicKey: device.publicKeySpkiB64, setupCode: (await f('/api/sandbox/setup-code')).body.setupCode } }) };
  };
  try {
    const a = browser(), b = browser(); await a.setup(); await b.setup();
    const mode = (await a.f('/api/mode')).body;
    assert.equal(mode.sample.rentUsdc, 15); assert.equal(mode.sample.landlord, MOCK_LANDLORD); assert.match(mode.sample.refundTo, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    // fund both worlds, then a withdrawal request in A
    for (const w of [a, b]) { const q = await w.f('/api/pay/demo/quote', { method: 'POST', body: { amountUsdc: 20, refundTo: mode.sample.refundTo } }); await w.f('/api/mock/pay', { method: 'POST', body: { address: q.body.address } }); }
    for (let i = 0; i < 10; i++) { await sb.tickAll(); await new Promise((r) => setTimeout(r, 40)); }
    const reserve0 = (await a.signed('/api/home/state')).body.reserve; assert.ok(reserve0 > 10_000_000);
    const ex = await a.signed('/api/home/exit', { method: 'POST', body: { amountUsdc: 2 } });
    assert.equal(ex.status, 200);
    assert.equal((await b.f('/api/sandbox/approve-withdrawal', { method: 'POST', body: { requestId: ex.body.requestId } })).status, 404); // B cannot approve A's request
    assert.equal((await a.f('/api/sandbox/approve-withdrawal', { method: 'POST', body: { requestId: ex.body.requestId } })).status, 200);
    let reserve1; for (let i = 0; i < 20; i++) { await sb.tickAll(); reserve1 = (await a.signed('/api/home/state')).body.reserve; if (reserve1 < reserve0) break; await new Promise((r) => setTimeout(r, 40)); }
    assert.equal(reserve1, reserve0 - 2_000_000);
    assert.equal((await a.f('/api/sandbox/approve-withdrawal', { method: 'POST', body: { requestId: 'bogus' } })).status, 404);
  } finally { server.close(); sb.close(); }
});

test('Home is a "home device" in the UI: the word "laptop" appears only in the one definition, and the setup screen says so', () => {
  const def = 'a laptop, desktop, tablet or spare phone that stays at home, never the phone you carry';
  let defs = 0;
  for (const f of fs.readdirSync('web/src').filter((n) => /\.(jsx?)$/.test(n))) {
    const text = fs.readFileSync(`web/src/${f}`, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
    defs += text.split(def).length - 1;
    assert.equal(/laptop/i.test(text.split(def).join('')), false, `${f} still calls Home a laptop`);
  }
  assert.equal(defs, 1, 'the definition appears once in the UI');
  assert.match(fs.readFileSync('web/src/App.jsx', 'utf8'), /<Gate title="Set up your home device">/);
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.equal(readme.split(def).length - 1, 1, 'the README explains "home device" once');
  assert.equal((readme.match(/laptop/gi) ?? []).length, 1, 'and "laptop" appears in the README only inside that explanation');
});

test('the demo video link is set (README top links and the landing page default), with no placeholder left', async () => {
  const V = 'https://x.com/Web3AJ_/status/2121667799516909792?a=2s4S7XcUkoB5KzMbTkY&s=20';
  assert.match(fs.readFileSync('README.md', 'utf8'), new RegExp(`\\*\\*Demo video:\\*\\* ${V.replace(/[.?]/g, '\\$&')}`));
  const { loadConfig } = await import('../server/config.js');
  assert.equal(loadConfig({ CARRY_MODE: 'mock', CARRY_DB: ':memory:' }).videoUrl, V);
  assert.equal(/link added after recording/i.test(fs.readFileSync('README.md', 'utf8')), false);
  assert.match(fs.readFileSync('README.md', 'utf8'), /On iPhone\/iPad Safari, the browser may clear a site's stored data after about 7 days without a visit/);
});
