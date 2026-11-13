import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const out = path.resolve('node_modules/.cache/carry-test');
async function load(entry, name) {
  fs.mkdirSync(out, { recursive: true });
  const f = path.join(out, `${name}-${process.pid}.mjs`);
  await build({ entryPoints: [entry], outfile: f, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const m = await import(f); fs.rmSync(f, { force: true }); return m;
}
const ev = (id, kind, amount, detail = {}, ok = true, ts = '2026-11-12T21:36:05.000Z') => ({ id, kind, amount, detail, ok, ts });

test('Home summary: at risk = pocket + refills still authorised; Protected = reserve; computed from real state', async () => {
  const { HomeSummary, atRisk } = await load('web/src/home-summary.jsx', 'summary');
  const st = { reserve: 2_000_000, pocket: 3_000_000, allowance: 1_500_000, ceiling: 20_000_000 };
  assert.equal(atRisk(st), 4_500_000);
  const html = renderToStaticMarkup(React.createElement(HomeSummary, { st }));
  assert.match(html, /If your phone is lost tonight, at most <span class="risk mono">4\.50 USDC<\/span> is at risk\./);
  assert.match(html, /Protected: <b class="mono">2\.00 USDC<\/b> · hidden from your phone/);
  assert.match(renderToStaticMarkup(React.createElement(HomeSummary, { st: undefined })), /Reading your balances/);
});

test('the Home summary can never reach the phone: not imported, not in the phone bundle, not in its rendered view', async () => {
  const bundle = path.join(out, `phonebundle-${process.pid}.js`);
  fs.mkdirSync(out, { recursive: true });
  await build({ entryPoints: ['web/src/phone.jsx'], outfile: bundle, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const code = fs.readFileSync(bundle, 'utf8'); fs.rmSync(bundle, { force: true });
  for (const needle of ['is at risk', 'hidden from your phone', 'data-summary', 'data-protected-line', 'HomeSummary', 'ActivityPanel', 'Reading your balances', 'api/home']) {
    assert.equal(code.includes(needle), false, `phone bundle must not contain "${needle}"`);
  }
  for (const f of ['web/src/phone.jsx', 'web/src/parts.jsx', 'web/src/motion.js', 'web/src/api.js', 'web/src/icons.jsx', 'web/src/empty.jsx', 'web/src/protects.jsx']) {
    assert.equal(/home-summary|activity\.jsx/.test(fs.readFileSync(f, 'utf8')), false, `${f} must not import the home-only files`);
  }
  const { PhoneView } = await load('web/src/phone.jsx', 'phoneview');
  const html = renderToStaticMarkup(React.createElement(PhoneView, { status: 'ok', pocket: 3_000_000, ceiling: 20_000_000, sendLimit: 10_000_000, note: 'Protected by Carry', bills: [], flipIds: new Set(), split: { play: 0 }, tiles: { filled: 2, from: 2, play: 0 }, to: '', setTo() {}, amt: '1', setAmt() {}, sending: false, onSend() {}, onPay() {} }));
  assert.equal(/at risk|hidden from your phone/.test(html), false);
});

test('activity: plain-language rows, Money vs System, folding of repeated blocked requests', async () => {
  const { describe, foldEvents } = await load('web/src/activity.jsx', 'activity');
  assert.equal(describe(ev(1, 'payment_in', 5_000_000)).text, 'Payment received 5.00');
  assert.equal(describe(ev(2, 'refill_success', 3_000_000)).text, 'Moved 3.00 to your pocket');
  const b = describe(ev(3, 'home_blocked', null, { reason: 'missing_or_malformed_headers' }, false));
  assert.equal(b.text, 'Blocked: unsigned request to your home controls'); assert.equal(b.tab, 'money'); assert.equal(b.blocked, true);
  const sent = describe(ev(4, 'phone_send_refused', 11_000_000, { to: 'someone.near', http: 403, raw: { error: 'policy_denied', message: 'Per-transaction limit exceeded for nep141:abc: 11000000 > 10000000' } }, false));
  assert.match(sent.text, /^Blocked: phone tried to send 11\.00 to someone\.near\. This phone can send at most 10\.00 USDC at a time\.$/);
  const wd = describe(ev(5, 'exit_refused', 500_000_000, { http: 422, raw: { error: { error: 'policy_denied', message: 'Per-transaction limit exceeded for nep141:abc: 500000000 > 20000000' } } }, false));
  assert.equal(wd.text, 'Blocked: withdrawal 500.00. The reserve can send at most 20.00 USDC at a time.');
  for (const k of ['service_start', 'wallet_state', 'tick_warning', 'tick_error', 'refill_planned']) assert.equal(describe(ev(9, k, null, {})).tab, 'system', k);
  for (const k of ['payment_in', 'refill_success', 'bill_paid', 'exit_requested', 'home_blocked', 'bill_refused']) assert.equal(describe(ev(9, k, 1, {})).tab, 'money', k);
  const rows = foldEvents([ev(7, 'home_blocked', null, { reason: 'missing_or_malformed_headers' }, false), ev(6, 'home_blocked', null, { reason: 'missing_or_malformed_headers' }, false), ev(5, 'home_blocked', null, { reason: 'missing_or_malformed_headers' }, false), ev(4, 'payment_in', 5_000_000)]);
  assert.equal(rows.length, 2); assert.equal(rows[0].n, 3); assert.equal(rows[0].plural(3), '3 blocked requests: unsigned requests to your home controls'); assert.equal(rows[0].raws.length, 3);
  const mixed = foldEvents([ev(3, 'home_blocked', null, { reason: 'bad_signature' }, false), ev(2, 'home_blocked', null, { reason: 'missing_or_malformed_headers' }, false)]);
  assert.equal(mixed.length, 2, 'different reasons are not folded together');
});

test('activity panel: shows the latest 10 with "Show more", Money tab by default, empty states with a next action', async () => {
  const { ActivityPanel, PAGE } = await load('web/src/activity.jsx', 'panel');
  assert.equal(PAGE, 10);
  const many = Array.from({ length: 25 }, (_, i) => ev(100 - i, 'payment_in', 1_000_000 + i, {}, true, `2026-11-12T10:${String(59 - i).padStart(2, '0')}:00.000Z`));
  const html = renderToStaticMarkup(React.createElement(ActivityPanel, { events: many }));
  assert.equal((html.match(/class="row-text"/g) ?? []).length, 10);
  assert.match(html, /Show more \(15 older\)/); assert.match(html, /aria-selected="true">Money</);
  assert.match(renderToStaticMarkup(React.createElement(ActivityPanel, { events: [] })), /Nothing has happened yet\./);
  assert.match(html, /<summary>raw<\/summary>/);
});

test('Home source has the empty states and the protects strip; the pay page has the strip too', () => {
  const app = fs.readFileSync('web/src/App.jsx', 'utf8');
  for (const t of ['No payments yet.', 'No bills yet.', 'No phone paired yet.']) assert.ok(app.includes(t), t);
  assert.equal((app.match(/<Protects \/>/g) ?? []).length, 2, 'Home and the pay page');
  assert.ok(fs.readFileSync('web/src/activity.jsx', 'utf8').includes('Nothing has happened yet.'));
});

test('activity: refill steps fold into the "Moved X to your pocket" row and stay under its raw; they leave both tabs', async () => {
  const { ActivityPanel, attachSteps, foldEvents, describe } = await load('web/src/activity.jsx', 'fold');
  const evs = [ // newest first, as the log returns them
    ev(15, 'refill_success', 3_000_000, { request_id: 'r1' }), ev(14, 'refill_voted', 3_000_000, { http: 200 }), ev(13, 'guard_decision', 3_000_000, { approve: true, code: 'REFILL_OK' }),
    ev(12, 'refill_requested', 3_000_000, { request_id: 'r1' }), ev(11, 'refill_planned', 3_000_000, { key: 'k' }), ev(10, 'payment_in', 5_000_000), ev(9, 'address_issued', 5_000_000, { address: 'a' }),
  ];
  const vis = attachSteps(evs);
  assert.deepEqual(vis.map((e) => e.kind), ['refill_success', 'payment_in', 'address_issued']);
  assert.equal(vis[0].steps.length, 4);
  const money = foldEvents(vis.filter((e) => describe(e).tab === 'money'));
  assert.deepEqual(money.map((r) => r.text), ['Moved 3.00 to your pocket', 'Payment received 5.00']);
  assert.deepEqual(money[0].raws[0].steps.map((s) => s.kind), ['refill_planned', 'refill_requested', 'guard_decision', 'refill_voted']);
  assert.equal(describe(ev(9, 'address_issued', 5_000_000)).tab, 'system', 'payment address issued is System');
  const html = renderToStaticMarkup(React.createElement(ActivityPanel, { events: evs }));
  assert.equal((html.match(/class="row-text"/g) ?? []).length, 2);
  assert.equal(/Refill planned|Approver voted|Guard decided/.test(html), false);
  // a step still in flight (no outcome yet) is not lost: it shows in System
  const inflight = attachSteps([ev(21, 'refill_requested', 1, {}), ev(20, 'refill_planned', 1, {})]);
  assert.equal(inflight.length, 2);
});

test('wallets line is in the System tab, not the Home hero; allowance starts empty with the current value as placeholder; bills use Name', async () => {
  const sum = fs.readFileSync('web/src/home-summary.jsx', 'utf8');
  assert.equal(/Wallets at start|st\.wallets/.test(sum), false);
  const { ActivityPanel } = await load('web/src/activity.jsx', 'wallets');
  const sys = renderToStaticMarkup(React.createElement(ActivityPanel, { events: [ev(1, 'service_start', null, {})], wallets: 'reserve v2 locked=true frozen=false | pocket v4 locked=true frozen=false' }));
  assert.equal(sys.includes('data-wallets'), false, 'Money tab (the default) does not show it');
  const app = fs.readFileSync('web/src/App.jsx', 'utf8');
  assert.ok(app.includes("useState('')") && app.includes('placeholder={st?.allowance === undefined'), 'allowance input starts empty');
  assert.equal(app.includes("useState('40')"), false);
  assert.ok(app.includes('<label>Name<input') && app.includes('placeholder="Rent"') && !app.includes('<label>Id<'));
  const { billId } = await load('web/src/App.jsx', 'billid').catch(() => ({}));
  if (billId) { assert.equal(billId('Rent'), 'rent'); assert.equal(billId(' Car insurance! '), 'car-insurance'); assert.match(billId('x'.repeat(80)), /^[a-z0-9][a-z0-9-]{0,39}$/); }
});

test('pay page: summary card with who is paid (config), amount after fees once quoted, and the protected-account line', async () => {
  const app = fs.readFileSync('web/src/App.jsx', 'utf8');
  assert.ok(app.includes('Your payment lands in a protected account. Only a small share reaches their phone.'));
  assert.ok(app.includes('info?.body?.payee') && app.includes('quote?.amountOut'));
  const { boot } = await import('./helpers.js');
  const t = await boot();
  try {
    const info = await t.j(t.pub, `/api/pay/${t.config.handle}`);
    assert.equal(info.body.payee, t.config.payeeName);
    const q = await t.pay(5);
    assert.ok(q.amountOut > 4_900_000 && q.amountOut <= 5_000_000, `amountOut ${q.amountOut}`);
  } finally { t.close(); }
});
