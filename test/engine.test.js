import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';
import { MOCK_LANDLORD, MOCK_POCKET_KEY } from '../server/mock.js';

const M = 1_000_000n;

test('payment in -> arrival logged -> one guarded, voted refill -> pocket funded, reserve keeps the rest', async () => {
  const t = await boot({ allowance: 40_000_000 });
  try {
    await t.pay(12);
    await t.settleAll();
    const k = t.kinds();
    for (const want of ['wallet_state', 'address_issued', 'payment_in', 'refill_planned', 'refill_requested', 'guard_decision', 'refill_voted', 'refill_success']) assert.ok(k.includes(want), `missing ${want} in ${k}`);
    const pocket = t.svc.mock.bal.pocket, reserve = t.svc.mock.bal.reserve;
    assert.equal(pocket, 11_997_600n); // 12 USDC in, 0.02% mock fee
    assert.equal(reserve, 0n);
    assert.equal(t.svc.store.allowance(), 40_000_000n - 11_997_600n);
    const phone = await t.j(t.pub, '/api/phone/state', { headers: { Authorization: `Bearer ${MOCK_POCKET_KEY}` } });
    assert.equal(phone.body.pocket, 11_997_600);
    assert.equal('reserve' in phone.body, false);
  } finally { t.close(); }
});

test('two near-simultaneous payments: pocket ends <= ceiling, remainder stays in the reserve, one refill per arrival', async () => {
  const t = await boot({ allowance: 100_000_000 });
  try {
    await t.pay(15); await t.pay(15.5);
    await Promise.all([t.svc.tick(), t.svc.tick(), t.svc.tick()]); // concurrent ticks must serialise
    await t.settleAll(20);
    const pocket = t.svc.mock.bal.pocket;
    assert.ok(pocket <= 20n * M, `pocket ${pocket} over ceiling`);
    assert.equal(pocket, 20n * M);
    assert.equal(pocket + t.svc.mock.bal.reserve, 30_493_900n); // nothing lost: 14,997,000 + 15,496,900
    const rows = t.svc.store.raw.prepare('SELECT arrival, COUNT(*) c FROM refills WHERE arrival IS NOT NULL GROUP BY arrival').all();
    assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.c === 1));
    // both arrivals were seen before the first refill, so the first tops the pocket to the ceiling and the second is skipped
    const states = t.svc.store.raw.prepare('SELECT state FROM refills ORDER BY id').all().map((r) => r.state);
    assert.deepEqual(states, ['success', 'skipped']);
    assert.match(t.svc.store.events(100).find((e) => e.kind === 'refill_skipped').detail.why, /ceiling/);
  } finally { t.close(); }
});

test('refills stop when the total allowance is used; the log says why', async () => {
  const t = await boot({ allowance: 3_000_000 });
  try {
    await t.pay(10); await t.settleAll();
    assert.equal(t.svc.mock.bal.pocket, 3_000_000n);
    assert.equal(t.svc.store.allowance(), 0n);
    await t.pay(5); await t.settleAll();
    assert.equal(t.svc.mock.bal.pocket, 3_000_000n); // unchanged
    const skipped = t.svc.store.events(100).find((e) => e.kind === 'refill_skipped');
    assert.match(skipped.detail.why, /allowance/);
  } finally { t.close(); }
});

test('re-running cycles is idempotent: no extra refills, no extra allowance spent', async () => {
  const t = await boot({ allowance: 40_000_000 });
  try {
    await t.pay(5); await t.settleAll();
    const before = t.svc.store.raw.prepare('SELECT COUNT(*) c FROM refills').get().c;
    const allowance = t.svc.store.allowance();
    await t.settleAll(10);
    assert.equal(t.svc.store.raw.prepare('SELECT COUNT(*) c FROM refills').get().c, before);
    assert.equal(t.svc.store.allowance(), allowance);
  } finally { t.close(); }
});

test('timer top-up refills the pocket after the phone spends, from the real balance', async () => {
  const t = await boot({ allowance: 100_000_000 });
  try {
    await t.pay(20); await t.settleAll();
    assert.ok(t.svc.mock.bal.pocket > 19_900_000n);
    await t.pay(10); await t.settleAll(); // reserve now holds ~10 (pocket full)
    const send = await t.j(t.pub, '/api/phone/send', { method: 'POST', headers: { Authorization: `Bearer ${MOCK_POCKET_KEY}` }, body: { to: MOCK_LANDLORD, amountUsdc: 5 } });
    assert.equal(send.status, 200);
    await t.settleAll(10);
    // the timer bucket is 5 min, so bring it forward by clearing the key space
    t.svc.store.raw.exec("DELETE FROM refills WHERE key LIKE 'timer-%'");
    await t.settleAll(10);
    assert.ok(t.svc.mock.bal.pocket <= 20n * M);
    assert.ok(t.svc.mock.bal.pocket > 19_000_000n, `pocket ${t.svc.mock.bal.pocket}`);
  } finally { t.close(); }
});

test('GUARD_SHAPE_CHANGED: an unrecognised approval field halts refills loudly, nothing is voted', async () => {
  const t = await boot({ allowance: 40_000_000, mockOpts: { tweakApproval: (a) => { a.op.new_field = 'surprise'; return a; } } });
  try {
    await t.pay(5); await t.settleAll();
    const ev = t.svc.store.events(100).find((e) => e.kind === 'GUARD_SHAPE_CHANGED');
    assert.ok(ev, 'no GUARD_SHAPE_CHANGED event');
    assert.equal(ev.ok, false); assert.equal(ev.detail.code, 'UNEXPECTED_FIELD');
    assert.equal(t.svc.engine.halted.code, 'GUARD_SHAPE_CHANGED');
    assert.equal(t.svc.mock.bal.pocket, 0n);
    assert.equal(t.svc.store.allowance(), 40_000_000n); // nothing reserved
    assert.ok([...t.svc.mock.approvals.values()].every((a) => a.status === 'pending')); // no vote was cast
    const home = await t.j(t.home, '/api/home/state');
    assert.equal(home.body.halted.code, 'GUARD_SHAPE_CHANGED');
  } finally { t.close(); }
});

test('stored bill: paid once by id; amount/payee in the body refused; second use and expiry refused', async () => {
  let clock = Date.parse('2026-11-12T10:00:00Z');
  const t = await boot({ allowance: 0, now: () => clock, mockOpts: { now: Date.now } }); // the mock settles on real time
  try {
    t.svc.mock.credit(30_000_000);
    const make = (id, amountUsdc, expiresAt) => t.j(t.home, '/api/home/bills', { method: 'POST', body: { id, label: id, payee: MOCK_LANDLORD, amountUsdc, expiresAt } });
    assert.equal((await make('rent', 15, '2026-11-12T12:00:00Z')).status, 200);
    assert.equal((await make('old', 2, '2026-11-12T10:30:00Z')).status, 200);
    const pay = (id, body) => t.j(t.pub, `/api/phone/bills/${id}/pay`, { method: 'POST', body: body ?? {} });
    assert.equal((await pay('rent', { amountUsdc: 1 })).status, 400);           // altered amount
    assert.equal((await pay('rent', { payee: 'evil.near' })).status, 400);      // altered payee
    assert.equal(t.svc.mock.bal.reserve, 30n * M);                              // nothing moved
    const first = await pay('rent'); assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(t.svc.mock.bal.reserve, 15n * M);
    const second = await pay('rent'); assert.equal(second.status, 422); assert.equal(second.body.code, 'BILL_USED');
    assert.equal(t.svc.mock.bal.reserve, 15n * M);
    clock += 3600e3; // past 'old' expiry
    const late = await pay('old'); assert.equal(late.status, 422); assert.equal(late.body.code, 'BILL_EXPIRED');
    assert.equal(t.svc.mock.bal.reserve, 15n * M);
    assert.equal((await pay('nope')).body.code, 'NO_SUCH_BILL');
  } finally { t.close(); }
});
