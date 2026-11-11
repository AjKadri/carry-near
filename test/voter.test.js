import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';
import { MOCK_POCKET_ACCOUNT } from '../server/mock.js';
import { APPROVAL_MAX_AGE_MS } from '../server/guard.js';

test('voter refuses an expired or stale approval (code APPROVAL_EXPIRED) and casts no vote', async () => {
  const t = await boot({ allowance: 0 });
  try {
    t.svc.mock.credit(5_000_000);
    const mk = async () => (await t.svc.ol.reserveTransfer(MOCK_POCKET_ACCOUNT, 10_000)).body;
    const a = await mk();
    for (const offset of [APPROVAL_MAX_AGE_MS + 1000, 25 * 3600e3]) {
      await assert.rejects(t.svc.ol.vote(a.approval_id, a.request_hash, { now: Date.now() + offset }), (e) => e.code === 'APPROVAL_EXPIRED');
    }
    assert.equal(t.svc.mock.approvals.get(a.approval_id).status, 'pending'); // no vote reached OutLayer
    const ok = await t.svc.ol.vote(a.approval_id, a.request_hash, { now: Date.now() });   // control: a fresh one still works
    assert.equal(ok.status, 200);
  } finally { t.close(); }
});

test('engine: a refill resumed after a long pause is refused, no vote, allowance given back', async () => {
  let off = 0; const clock = () => Date.now() + off;
  const t = await boot({ allowance: 40_000_000, now: clock, mockOpts: { now: clock } });
  try {
    t.svc.mock.credit(5_000_000);
    // simulate a crash after the allowance was reserved but before the vote
    const s = t.svc.store, amount = 1_000_000;
    s.createRefill({ key: 'crash-1', arrival: null, amount }); const id = s.refillByKey('crash-1').id;
    const req = (await t.svc.ol.reserveTransfer(MOCK_POCKET_ACCOUNT, amount)).body;
    s.updateRefill(id, { state: 'approved', request_id: req.request_id, approval_id: req.approval_id, request_hash: req.request_hash });
    assert.ok(s.reserveRefill(id, amount));
    assert.equal(s.allowance(), 39_000_000n);
    off += 10 * 60e3; // the service was down for ten minutes
    const bucket = Math.floor(clock() / t.config.topUpEveryMs); // keep the timer top-up out of this test
    for (const b of [bucket, bucket + 1]) { s.createRefill({ key: `timer-${b}`, arrival: null, amount: 0 }); s.updateRefill(s.refillByKey(`timer-${b}`).id, { state: 'skipped' }); }
    await t.svc.engine.cycle();
    const r = s.refill(id);
    assert.equal(r.state, 'refused');
    assert.equal(s.allowance(), 40_000_000n);                                  // given back
    assert.equal(t.svc.mock.approvals.get(req.approval_id).status, 'pending'); // never voted
    assert.equal(t.svc.mock.bal.pocket, 0n);
    const ev = s.events(50).find((e) => e.kind === 'refill_refused');
    assert.equal(ev.detail.code, 'APPROVAL_EXPIRED');
  } finally { t.close(); }
});
