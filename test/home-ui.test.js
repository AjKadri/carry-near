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
