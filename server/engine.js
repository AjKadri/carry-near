// Refill engine + bill payer. One thing at a time. Every step is logged; every vote goes through the guard.
import { decide, USDC_TOKEN } from './guard.js';
import { settle, scrub } from './outlayer.js';

export const MIN_TOPUP = 10_000n; // 0.01 USDC: smaller top-ups are not worth a round trip
// Guard refusals that mean "OutLayer's approval looks different from what we expect", not "this request is bad".
const SHAPE_CODES = new Set(['UNEXPECTED_FIELD', 'NO_OP', 'MALFORMED', 'WRONG_KIND', 'DATA_MISMATCH']);
const big = (n) => BigInt(n);

export function makeEngine({ store, ol, pocketAccount, now = Date.now, topUpEveryMs = 5 * 60e3, settleOpts = {} }) {
  let busy = Promise.resolve();
  const e = {
    halted: null, // { code, at, approvalId, detail } after GUARD_SHAPE_CHANGED; refills stop until restart/clear
    lastCycle: null,
    clearHalt() { e.halted = null; },
    serial(fn) { const run = busy.then(fn, fn); busy = run.catch(() => {}); return run; }, // never two money moves at once

    async logWalletState() { // rule: every live run starts by logging each wallet's policy version and locked state
      const out = [];
      for (const role of ['reserve', 'pocket']) {
        try { const p = await ol.policyState(role); out.push(`${role} v${p.version} locked=${p.locked} frozen=${p.frozen}`); store.log('wallet_state', null, p, p.locked); }
        catch (err) { out.push(`${role} unreadable: ${err.message}`); store.log('wallet_state', null, { role, error: err.message }, false); }
      }
      return out.join(' | ');
    },

    cycle() { return e.serial(() => cycle()); },
    payBill(id) { return e.serial(() => payBill(id)); },
  };

  async function cycle() {
    const summary = { resumed: 0, planned: 0, done: [] };
    // 1. finish anything already in flight (crash-safe: state lives in SQLite)
    for (const r of store.activeRefills()) { summary.resumed++; await advance(r.id); }
    if (store.activeRefills().length) { e.lastCycle = { at: now(), ...summary }; return summary; }
    if (e.halted) { e.lastCycle = { at: now(), ...summary, halted: e.halted.code }; return summary; }
    // 2. one new refill: for the oldest arrival that has none, else the timer
    const arrival = store.arrivalsWithoutRefill()[0];
    const key = arrival ? `arrival-${arrival.address}` : `timer-${Math.floor(now() / topUpEveryMs)}`;
    if (!store.refillByKey(key)) {
      const planned = await plan(key, arrival?.address ?? null);
      if (planned) { summary.planned++; await advance(planned); }
    }
    e.lastCycle = { at: now(), ...summary };
    return summary;
  }

  // topup = min(ceiling - pocket(actual), allowance left, reserve balance)
  async function plan(key, arrival) {
    // A timer tick with no arrival and no allowance cannot do anything: do not call the platform at all (this used to be 2 balance reads every 5 s, all day).
    if (!arrival && store.allowance() < MIN_TOPUP) return null;
    // Timer tick, nothing arrived: ask for the pocket first; if it is already at its ceiling there is nothing to top up, so the reserve is not read.
    let pocket = await ol.confBalance('pocket');
    if (!arrival && store.ceiling() - pocket < MIN_TOPUP) return null;
    const reserve = await ol.confBalance('reserve');
    const ceiling = store.ceiling(), allowance = store.allowance();
    const room = ceiling > pocket ? ceiling - pocket : 0n;
    const amount = [room, allowance, reserve].reduce((a, b) => (b < a ? b : a));
    const why = room < MIN_TOPUP ? 'pocket is at its ceiling' : allowance < MIN_TOPUP ? 'no refill allowance left' : reserve < MIN_TOPUP ? 'reserve is empty' : null;
    if (amount < MIN_TOPUP || why) {
      if (arrival) { store.createRefill({ key, arrival, amount: 0 }); store.updateRefill(store.refillByKey(key).id, { state: 'skipped' }); store.log('refill_skipped', null, { key, why, pocket: String(pocket), ceiling: String(ceiling), allowance: String(allowance), reserve: String(reserve) }); }
      return null; // timer ticks with nothing to do are silent
    }
    store.createRefill({ key, arrival, amount: Number(amount) });
    const id = store.refillByKey(key).id;
    store.log('refill_planned', Number(amount), { key, pocket: String(pocket), ceiling: String(ceiling), allowance: String(allowance), reserve: String(reserve) });
    return id;
  }

  const fail = (id, state, kind, amount, detail, ok = false) => { store.updateRefill(id, { state, detail }); store.log(kind, amount, detail, ok); };

  async function advance(id) {
    let r = store.refill(id);
    try {
      if (r.state === 'planned') {
        const res = await ol.reserveTransfer(pocketAccount, r.amount, r.key);
        if (res.status !== 200 || res.body?.status !== 'pending_approval') {
          return fail(id, 'refused', 'refill_refused', r.amount, { step: 'request', http: res.status, raw: JSON.parse(scrub(res.body)) });
        }
        store.updateRefill(id, { state: 'requested', request_id: res.body.request_id, approval_id: res.body.approval_id, request_hash: res.body.request_hash });
        store.log('refill_requested', r.amount, { request_id: res.body.request_id, approval_id: res.body.approval_id });
        r = store.refill(id);
      }
      if (r.state === 'requested') {
        const approvals = await ol.pendingApprovals();
        const approval = approvals.find((a) => a.approval_id === r.approval_id);
        if (!approval) { // not pending any more: someone else (the owner) may have approved it
          const s = await ol.request('reserve', r.request_id);
          if (s.body?.status === 'success') { store.updateRefill(id, { state: 'success' }); store.log('refill_success', r.amount, { request_id: r.request_id, note: 'approved outside Carry' }); }
          return;
        }
        const ctx = {
          pocketAccount, pocketBalance: await ol.confBalance('pocket'), inFlight: 0n, ceiling: store.ceiling(),
          allowance: store.allowance() + (r.reserved ? big(r.amount) : 0n), bills: store.bills(), now: now(),
        };
        const d = decide(approval, ctx);
        const detail = { approval_id: r.approval_id, approve: d.approve, code: d.code, reason: d.reason };
        if (!d.approve) {
          if (SHAPE_CODES.has(d.code)) {
            e.halted = { code: 'GUARD_SHAPE_CHANGED', at: now(), approvalId: r.approval_id, detail: d };
            store.log('GUARD_SHAPE_CHANGED', null, { ...detail, approval: JSON.parse(scrub(approval)), note: 'OutLayer returned an approval shape the guard does not recognise. Refills are halted by design until this is reviewed.' }, false);
          }
          return fail(id, 'refused', 'refill_refused', r.amount, { step: 'guard', ...detail });
        }
        store.log('guard_decision', r.amount, detail);
        if (!r.reserved && !store.reserveRefill(id, r.amount)) return fail(id, 'refused', 'refill_refused', r.amount, { step: 'reserve', reason: 'allowance changed before reservation' });
        store.updateRefill(id, { request_hash: d.requestHash });
        r = store.refill(id);
      }
      if (r.state === 'approved') {
        const v = await ol.vote(r.approval_id, r.request_hash, { now: now() });
        if (v.status === 200 || v.status === 409) { store.updateRefill(id, { state: 'voted' }); store.log('refill_voted', r.amount, { http: v.status, approval_id: r.approval_id }); }
        else return fail(id, 'failed', 'refill_failed', r.amount, { step: 'vote', http: v.status, raw: JSON.parse(scrub(v.body)) });
        r = store.refill(id);
      }
      if (r.state === 'voted') {
        const s = await settle(ol, 'reserve', r.request_id, settleOpts);
        if (s.status === 'success') { store.updateRefill(id, { state: 'success' }); store.log('refill_success', r.amount, { request_id: r.request_id }, true); }
        else if (s.status === 'timeout') store.log('refill_waiting', r.amount, { request_id: r.request_id, note: 'not settled yet; will check again next cycle' });
        else {
          if (s.body?.result?.never_submitted === true || s.body?.never_submitted === true) store.releaseRefill(id);
          fail(id, 'failed', 'refill_failed', r.amount, { step: 'settle', status: s.status, raw: JSON.parse(scrub(s.body ?? {})) });
        }
      }
    } catch (err) {
      if (['HASH_CHANGED', 'APPROVAL_EXPIRED', 'STALE_UNREADABLE'].includes(err.code)) { // no vote was cast, so nothing can execute: give the allowance back
        store.releaseRefill(id);
        return fail(id, 'refused', 'refill_refused', r.amount, { step: 'vote', code: err.code, reason: err.message });
      }
      store.log('refill_error', r.amount, { state: r.state, error: err.message }, false); // state stays; next cycle retries
    }
  }

  // The phone triggers a bill by ID only. Payee and amount come from the stored bill, never from the caller.
  async function payBill(id) {
    const bill = store.bills().find((b) => b.id === id);
    if (!bill) { store.log('bill_refused', null, { id, reason: 'no such bill' }, false); return { ok: false, code: 'NO_SUCH_BILL' }; }
    if (bill.used) { store.log('bill_refused', Number(bill.amount), { id, code: 'BILL_USED', reason: 'already paid' }, false); return { ok: false, code: 'BILL_USED' }; }
    if (now() >= bill.expiresAt) { store.log('bill_refused', Number(bill.amount), { id, code: 'BILL_EXPIRED', reason: 'expired' }, false); return { ok: false, code: 'BILL_EXPIRED' }; }
    const res = await ol.reserveWithdraw(bill.payee, bill.amount, `bill-${id}`);
    if (res.status !== 200 || res.body?.status !== 'pending_approval') {
      store.log('bill_refused', Number(bill.amount), { id, step: 'request', http: res.status, raw: JSON.parse(scrub(res.body)) }, false);
      return { ok: false, code: 'OUTLAYER_REFUSED', http: res.status, raw: JSON.parse(scrub(res.body)) };
    }
    const approval = (await ol.pendingApprovals()).find((a) => a.approval_id === res.body.approval_id);
    const d = approval ? decide(approval, { pocketAccount, pocketBalance: 0n, allowance: 0n, bills: store.bills(), now: now() }) : { approve: false, code: 'NOT_PENDING', reason: 'approval not found' };
    if (!d.approve) {
      if (SHAPE_CODES.has(d.code)) { e.halted = { code: 'GUARD_SHAPE_CHANGED', at: now(), approvalId: res.body.approval_id, detail: d }; store.log('GUARD_SHAPE_CHANGED', null, { id, code: d.code, reason: d.reason, approval: approval ? JSON.parse(scrub(approval)) : null }, false); }
      store.log('bill_refused', Number(bill.amount), { id, step: 'guard', code: d.code, reason: d.reason, request_id: res.body.request_id }, false);
      return { ok: false, code: d.code, reason: d.reason };
    }
    if (!store.markBillUsed(d.consume.billId, res.body.request_id)) return { ok: false, code: 'BILL_USED' }; // consume BEFORE voting
    store.log('guard_decision', Number(bill.amount), { id, approve: true, code: d.code });
    let v;
    try { v = await ol.vote(res.body.approval_id, d.requestHash, { now: now() }); } catch (err) {
      if (['HASH_CHANGED', 'APPROVAL_EXPIRED', 'STALE_UNREADABLE'].includes(err.code)) store.unuseBill(id); // never voted, so the bill was not paid
      store.log('bill_error', Number(bill.amount), { id, error: err.message, code: err.code }, false); return { ok: false, code: err.code ?? 'VOTE_ERROR' };
    }
    if (v.status !== 200 && v.status !== 409) { store.log('bill_failed', Number(bill.amount), { id, http: v.status, raw: JSON.parse(scrub(v.body)) }, false); return { ok: false, code: 'VOTE_FAILED' }; }
    const s = await settle(ol, 'reserve', res.body.request_id, settleOpts);
    if (s.status === 'success') { store.log('bill_paid', Number(bill.amount), { id, payee: bill.payee, request_id: res.body.request_id }, true); return { ok: true, requestId: res.body.request_id }; }
    if (s.body?.result?.never_submitted === true) store.unuseBill(id);
    store.log('bill_failed', Number(bill.amount), { id, status: s.status, raw: JSON.parse(scrub(s.body ?? {})) }, false);
    return { ok: false, code: 'SETTLE_' + s.status };
  }
  return e;
}
