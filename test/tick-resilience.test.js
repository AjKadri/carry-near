import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';
import { retryRead, isTransient } from '../server/outlayer.js';

// Found in the live Home log (tick_error entries, 11-13 Nov 2026): OutLayer's balance read answered 503 (keystore_error, or
// "1Click answered HTTP 503: Balance service unavailable") or timed out. Our tick read both balances every 5 s even when idle.
const noSleep = { sleep: async () => {} };
const err = (status, name) => Object.assign(new Error(`HTTP ${status}`), { status, name });

test('retryRead: a read that fails with 503 twice then works returns the answer; backoff grows', async () => {
  let n = 0; const waits = [];
  const v = await retryRead('GET /x', async () => { if (++n < 3) throw err(503); return 'ok'; }, { sleep: async (ms) => waits.push(ms) });
  assert.equal(v, 'ok'); assert.equal(n, 3); assert.deepEqual(waits, [500, 1500]);
});

test('retryRead: gives up after 3 tries on 5xx and annotates the error; 4xx is not retried; a timeout is retried once', async () => {
  let n = 0;
  await assert.rejects(retryRead('GET /bal', async () => { n++; throw err(503); }, noSleep), (e) => e.call === 'GET /bal' && e.attempts === 3 && e.transient === true);
  n = 0;
  await assert.rejects(retryRead('GET /bal', async () => { n++; throw err(401); }, noSleep), (e) => e.attempts === 1 && e.transient === false);
  assert.equal(n, 1);
  n = 0;
  await assert.rejects(retryRead('GET /bal', async () => { n++; throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }, noSleep), (e) => e.attempts === 2 && e.transient);
  assert.equal(n, 2);
  assert.equal(isTransient(err(404)), false); assert.equal(isTransient(err(502)), true);
});

test('tick: a platform 503 on the balance read is a soft warning (tick_warning), not an error, and leaves no half-done refill; the next tick recovers', async () => {
  const t = await boot({ allowance: 3_000_000 });
  try {
    t.svc.mock.credit(5_000_000);
    const real = t.svc.ol.confBalance; let fail = true;
    t.svc.ol.confBalance = async (...a) => { if (fail) throw Object.assign(new Error('balance read failed: HTTP 503 {"error":"route_unavailable"}'), { status: 503, call: 'GET /wallet/v1/confidential/balance (reserve)', attempts: 3 }); return real(...a); };
    const q = await t.pay(5);
    await t.svc.tick(); await t.svc.tick(); await t.svc.tick();
    const ev = t.svc.store.events(50);
    assert.equal(ev.filter((e) => e.kind === 'tick_error').length, 0);
    const w = ev.filter((e) => e.kind === 'tick_warning');
    assert.equal(w.length, 1, 'repeated identical warnings are folded into one per 5 minutes');
    assert.equal(w[0].ok, true); assert.equal(w[0].detail.status, 503); assert.equal(w[0].detail.call, 'GET /wallet/v1/confidential/balance (reserve)'); assert.equal(w[0].detail.attempts, 3);
    assert.equal(t.svc.store.activeRefills().length, 0, 'no refill left half-done');
    assert.equal(t.svc.store.allowance(), 3_000_000n, 'allowance untouched');
    fail = false; await t.settleAll();
    assert.equal(t.svc.store.allowance(), 0n); // recovered: exactly one refill happened
    assert.equal(t.svc.store.events(200).filter((e) => e.kind === 'refill_success').length, 1);
    assert.ok(q);
  } finally { t.close(); }
});

test('tick: a real (non-transient) failure is still a tick_error', async () => {
  const t = await boot({ allowance: 3_000_000 });
  try {
    t.svc.ol.confBalance = async () => { throw Object.assign(new Error('balance read failed: HTTP 401 {"error":"invalid_api_key"}'), { status: 401, call: 'GET /wallet/v1/confidential/balance (pocket)', attempts: 1 }); };
    await t.pay(5); await t.svc.tick();
    const e = t.svc.store.events(50).find((x) => x.kind === 'tick_error');
    assert.ok(e && e.ok === false && e.detail.status === 401);
  } finally { t.close(); }
});

test('idle ticks: allowance 0 and no payment means zero platform reads; a full pocket costs one read, not two', async () => {
  const t = await boot({ allowance: 0 });
  try {
    let reads = 0; const real = t.svc.ol.confBalance;
    t.svc.ol.confBalance = async (...a) => { reads++; return real(...a); };
    for (let i = 0; i < 10; i++) await t.svc.tick();
    assert.equal(reads, 0, 'no allowance, no arrival: nothing to do, nothing to ask');
    t.svc.store.setAllowance(100_000_000n);
    await t.pay(20); await t.settleAll(); // pocket fills to its ceiling
    assert.ok(t.svc.mock.bal.pocket > 19_900_000n);
    reads = 0; for (let i = 0; i < 10; i++) await t.svc.tick();
    assert.equal(reads, 10, 'pocket full, allowance left: one read per tick (the pocket), the reserve is not read');
  } finally { t.close(); }
});
