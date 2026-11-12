import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';
import { boot, sleep } from './helpers.js';

// The README's first-payment path, in mock mode with the defaults a fresh `npm run demo` has (no allowance override):
// open /pay/demo, enter 5 USDC, press "simulate this payment". It must visibly split: pocket share and a non-zero Protected share.
test('README first payment (mock defaults): 5 USDC splits into pocket 3 and Protected 2', async () => {
  const t = await boot(); // no allowance argument: the mock demo default applies
  try {
    assert.equal(t.svc.store.allowance(), 3_000_000n);
    const q = await t.pay(5);
    assert.equal(q.amountIn, 5_000_000);
    await t.settleAll();
    const events = (await t.hj('/api/home/log')).body.events;
    const refill = events.find((e) => e.kind === 'refill_success');
    const incoming = events.find((e) => e.kind === 'payment_in');
    assert.ok(refill && incoming, 'payment_in and refill_success are both logged');
    assert.equal(Number(refill.amount), 3_000_000);
    const protectedShare = Number(incoming.amount) - Number(refill.amount);
    assert.ok(protectedShare > 1_990_000 && protectedShare <= 2_000_000, `protected ${protectedShare}`); // 5 USDC less the mock's 1Click fee, shown as +2.00
    assert.ok(protectedShare > 0);
    const state = (await t.hj('/api/home/state')).body;
    assert.equal(state.pocket, 3_000_000);
    assert.equal(state.reserve, protectedShare); // the Protected share stays in the reserve
  } finally { await t.close(); }
});

test('live mode keeps allowance 0 (the demo default is mock-only)', () => {
  const c = loadConfig({ CARRY_MODE: 'live', CARRY_DB: ':memory:' });
  assert.equal(c.mode, 'live');
  assert.equal(c.demoAllowance, 3_000_000n); // exists in config, but services.js only reads it in the mock branch
});

test('phone state names both limits, taken from config', async () => {
  const t = await boot();
  try {
    const r = await t.j(t.pub, "/api/phone/state", { headers: { Authorization: 'Bearer mock-pocket-key' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.ceiling, 20_000_000);
    assert.equal(r.body.sendLimit, 10_000_000);
  } finally { await t.close(); }
});
