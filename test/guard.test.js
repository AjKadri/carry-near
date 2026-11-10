import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, USDC_TOKEN } from '../server/guard.js';

const POCKET = '96cb4ed480cb63a7e7dfe95ba52fcd96d87e10eb2f1ae2e4630985c1fb086c5f';
const LANDLORD = 'd7041ab1063b3f017ae4d43857b225c2897b0d39682cbd2048c539a04b4805a4';
const EXIT = 'nearhacka.near';
const STRANGER = '57b6a7811afda6ddafb46c5bac8e2982f71719667be6895da87aa14af848fc8a';
const NOW = 1_800_000_000_000;

// Shapes copied from real pending approvals (carry-spike/evidence/t7.log, Tue 10 Nov 2026).
const transfer = (to, amount, over = {}) => ({
  approval_id: 'a1', request_id: 'r1', type: 'confidential', request_hash: 'h1',
  request_data: { to, token: USDC_TOKEN, amount },
  op: { amount, chain: 'near', flow: 'transfer', kind: 'confidential', to, token: USDC_TOKEN }, ...over,
});
const withdraw = (to, amount, over = {}) => ({
  approval_id: 'a2', request_id: 'r2', type: 'confidential', request_hash: 'h2',
  request_data: { to, chain: 'near', token: USDC_TOKEN, amount, destination_asset: USDC_TOKEN },
  op: { amount, chain: 'near', flow: 'withdraw', kind: 'confidential', to, token: USDC_TOKEN }, ...over,
});
const bill = (o = {}) => ({ id: 'rent', payee: LANDLORD, amount: '15000000', expiresAt: NOW + 3600_000, used: false, ...o });
const ctx = (o = {}) => ({ pocketAccount: POCKET, pocketBalance: 5_000_000n, inFlight: 0n, allowance: 40_000_000n, ceiling: 20_000_000n, bills: [bill()], now: NOW, ...o });
const show = (d) => JSON.stringify(d, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
const ok = (d, code) => { assert.equal(d.approve, true, show(d)); assert.equal(d.code, code); };
const refused = (d, code) => { assert.equal(d.approve, false, show(d)); assert.equal(d.code, code); assert.ok(d.reason.length > 0); };

// ---- refills (PROPOSAL-C §8 cases 1, 2, 3)
test('refill within ceiling and allowance is approved, consumes allowance', () => {
  const d = decide(transfer(POCKET, '10000000'), ctx());
  ok(d, 'REFILL_OK'); assert.deepEqual(d.consume, { allowance: 10_000_000n }); assert.equal(d.requestHash, 'h1');
});
test('refill that lands exactly on the ceiling is approved', () => ok(decide(transfer(POCKET, '15000000'), ctx()), 'REFILL_OK'));
test('case 1: refill over the phone ceiling is refused', () => refused(decide(transfer(POCKET, '15000001'), ctx()), 'OVER_CEILING'));
test('ceiling counts refills already in flight', () => refused(decide(transfer(POCKET, '10000000'), ctx({ inFlight: 6_000_000n })), 'OVER_CEILING'));
test('case 2: refill over the remaining total allowance is refused', () => refused(decide(transfer(POCKET, '3000001'), ctx({ allowance: 3_000_000n, pocketBalance: 0n })), 'OVER_ALLOWANCE'));
test('refill exactly equal to the remaining allowance is approved', () => ok(decide(transfer(POCKET, '3000000'), ctx({ allowance: 3_000_000n, pocketBalance: 0n })), 'REFILL_OK'));
test('allowance exhausted: nothing is approved', () => refused(decide(transfer(POCKET, '1'), ctx({ allowance: 0n })), 'OVER_ALLOWANCE'));
test('case 3a: transfer to a whitelisted non-pocket address (landlord, exit) is refused', () => {
  refused(decide(transfer(LANDLORD, '10000'), ctx()), 'REFILL_NOT_POCKET');
  refused(decide(transfer(EXIT, '10000'), ctx()), 'REFILL_NOT_POCKET');
});
test('case 3b: transfer to a non-whitelisted address is refused', () => refused(decide(transfer(STRANGER, '10000'), ctx()), 'REFILL_NOT_POCKET'));
test('lookalike pocket id is refused', () => refused(decide(transfer(POCKET.slice(0, -1) + 'e', '10000'), ctx()), 'REFILL_NOT_POCKET'));

// ---- bill (cases 4, 5, 6, 7)
test('stored bill, exact payee and amount, unused, before expiry: approved, consumes the bill', () => {
  const d = decide(withdraw(LANDLORD, '15000000'), ctx());
  ok(d, 'BILL_OK'); assert.deepEqual(d.consume, { billId: 'rent' });
});
test('case 4: bill with altered amount (+1 and -1) is refused', () => {
  refused(decide(withdraw(LANDLORD, '15000001'), ctx()), 'BILL_AMOUNT_MISMATCH');
  refused(decide(withdraw(LANDLORD, '14999999'), ctx()), 'BILL_AMOUNT_MISMATCH');
});
test('case 5: bill to an altered payee is refused', () => {
  refused(decide(withdraw(STRANGER, '15000000'), ctx()), 'BILL_UNKNOWN_PAYEE');
  refused(decide(withdraw(EXIT, '15000000'), ctx()), 'BILL_UNKNOWN_PAYEE');
});
test('case 6: second use of the bill is refused', () => refused(decide(withdraw(LANDLORD, '15000000'), ctx({ bills: [bill({ used: true })] })), 'BILL_USED'));
test('case 7: bill after expiry is refused (and at the expiry instant)', () => {
  refused(decide(withdraw(LANDLORD, '15000000'), ctx({ now: NOW + 3600_001 })), 'BILL_EXPIRED');
  refused(decide(withdraw(LANDLORD, '15000000'), ctx({ now: NOW + 3600_000 })), 'BILL_EXPIRED');
  ok(decide(withdraw(LANDLORD, '15000000'), ctx({ now: NOW + 3599_999 })), 'BILL_OK');
});
test('with two bills for one payee, the exact-amount unused one is picked', () => {
  const d = decide(withdraw(LANDLORD, '9000000'), ctx({ bills: [bill(), bill({ id: 'water', amount: '9000000' })] }));
  ok(d, 'BILL_OK'); assert.deepEqual(d.consume, { billId: 'water' });
});
test('no bills stored: any withdraw is refused', () => refused(decide(withdraw(LANDLORD, '15000000'), ctx({ bills: [] })), 'BILL_UNKNOWN_PAYEE'));
test('a withdraw to the pocket is not a bill', () => refused(decide(withdraw(POCKET, '1000'), ctx()), 'WITHDRAW_TO_POCKET'));
test('a withdraw on another chain is refused', () => {
  const a = withdraw(LANDLORD, '15000000'); a.op.chain = 'solana'; a.request_data.chain = 'solana';
  refused(decide(a, ctx()), 'WRONG_CHAIN');
});

// ---- everything else gets no vote
test('wrong approval type (public withdraw, transfer, call) is refused', () => {
  for (const type of ['transfer', 'withdraw', 'call', 'swap', 'cross_chain_withdraw', 'policy_update']) refused(decide(transfer(POCKET, '1000', { type }), ctx()), 'WRONG_TYPE');
});
test('swap, unshield, shield and unknown flows are refused', () => {
  for (const flow of ['swap', 'unshield', 'shield', 'deposit', '', undefined]) {
    const a = transfer(POCKET, '1000'); a.op.flow = flow; refused(decide(a, ctx()), 'WRONG_FLOW');
  }
});
test('wrong token is refused', () => {
  const a = transfer(POCKET, '1000'); a.op.token = 'nep141:wrap.near'; a.request_data.token = 'nep141:wrap.near';
  refused(decide(a, ctx()), 'WRONG_TOKEN');
});
test('bad amounts are refused: 0, negative, decimal, hex, leading zero, empty, number type, huge', () => {
  for (const amt of ['0', '-5', '1.5', '0x10', '010', '', ' 5', '5 ', 5, null, undefined, '9'.repeat(40)]) refused(decide(transfer(POCKET, amt), ctx()), 'BAD_AMOUNT');
});
test('missing op, mismatched request_data, destination asset, extra fields: refused', () => {
  refused(decide(transfer(POCKET, '1000', { op: null }), ctx()), 'NO_OP');
  const m = transfer(POCKET, '1000'); m.request_data.amount = '2000'; refused(decide(m, ctx()), 'DATA_MISMATCH');
  const t = transfer(POCKET, '1000'); t.request_data.to = LANDLORD; refused(decide(t, ctx()), 'DATA_MISMATCH');
  const d = withdraw(LANDLORD, '15000000'); d.request_data.destination_asset = 'nep141:wrap.near'; refused(decide(d, ctx()), 'WRONG_TOKEN');
  const x = transfer(POCKET, '1000'); x.op.memo = 'hi'; refused(decide(x, ctx()), 'UNEXPECTED_FIELD');
  const y = transfer(POCKET, '1000'); y.request_data.callback = 'http://x'; refused(decide(y, ctx()), 'UNEXPECTED_FIELD');
});
test('malformed input fails closed, never throws', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, { type: 'confidential' }]) assert.equal(decide(bad, ctx()).approve, false);
  assert.equal(decide(transfer(POCKET, '1000'), ctx({ pocketBalance: 5 })).approve, false); // number, not bigint
  assert.equal(decide(transfer(POCKET, '1000'), ctx({ allowance: undefined })).approve, false);
  assert.equal(decide(withdraw(LANDLORD, '15000000'), ctx({ now: undefined })).approve, false);
  assert.equal(decide(transfer(POCKET, '1000'), undefined).approve, false);
});
test('refusals never carry a consume instruction', () => {
  const d = decide(transfer(STRANGER, '1000'), ctx()); assert.equal(d.consume, undefined);
});

// ---- fuzz: whatever random op we throw, an approval implies the independent rules hold
test('fuzz: approvals only ever happen for the two allowed shapes', () => {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const tos = [POCKET, LANDLORD, EXIT, STRANGER, ''];
  const amts = ['1', '999', '5000000', '15000000', '15000001', '20000000', '0', '-1', '1.0', 'x'];
  const flows = ['transfer', 'withdraw', 'swap', 'unshield', undefined];
  const toks = [USDC_TOKEN, USDC_TOKEN, 'nep141:wrap.near'];
  const chains = ['near', 'near', 'solana'];
  const types = ['confidential', 'confidential', 'transfer', 'call'];
  let approved = 0;
  for (let i = 0; i < 5000; i++) {
    const to = pick(tos), amount = pick(amts), flow = pick(flows), token = pick(toks), chain = pick(chains), type = pick(types);
    const a = { approval_id: 'x', type, request_hash: 'h', request_data: { to, token, amount, chain }, op: { amount, chain, flow, kind: 'confidential', to, token } };
    const c = ctx({ pocketBalance: BigInt(pick([0, 5_000_000, 19_999_999])), allowance: BigInt(pick([0, 1_000_000, 40_000_000])) });
    const d = decide(a, c);
    if (!d.approve) continue;
    approved++;
    assert.equal(type, 'confidential'); assert.equal(token, USDC_TOKEN); assert.equal(chain, 'near');
    const n = BigInt(amount);
    if (flow === 'transfer') { assert.equal(to, POCKET); assert.ok(n <= c.allowance && c.pocketBalance + n <= 20_000_000n); }
    else { assert.equal(flow, 'withdraw'); assert.equal(to, LANDLORD); assert.equal(amount, '15000000'); }
  }
  assert.ok(approved > 0, 'fuzz should reach some approvals');
});
