// Pay link: receive from more chains. Address validation per chain, the exact 1Click quote request per chain,
// "only what 1Click lists", minimum and fee from the quote, and a mock payment on every chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, sleep } from './helpers.js';
import { CHAINS, validSolana, validEvm, validTron, listedChains, SAMPLE_REFUND } from '../server/chains.js';
import { quoteRequest, NEAR_USDC } from '../server/oneclick.js';
import { makeIntake } from '../server/intake.js';
import { openStore } from '../server/store.js';

const EVM = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const SOL = '7puyGCiSnh55z3EzWEr8MKDBw9FYH2izq4K4mXPNpcuo';
const TRON = SAMPLE_REFUND['tron-usdt'];
const REFUND = { 'sol-usdc': SOL, 'base-usdc': EVM, 'arb-usdc': EVM, 'eth-usdc': EVM, 'tron-usdt': TRON };

test('validation: Solana, EVM and Tron addresses; each rejects the others and malformed input with a clear message', () => {
  assert.equal(validSolana(SOL), null);
  for (const bad of ['', 'abc', EVM, TRON + 'x', SOL.replace('7', '0'), null]) assert.match(validSolana(bad), /Solana/i);
  assert.equal(validEvm(EVM), null);
  assert.equal(validEvm(EVM.toLowerCase()), null);
  for (const bad of ['', SOL, TRON, '0x12', EVM + '00', EVM.replace('0x', '1x'), '0xZZ' + EVM.slice(4), null]) assert.match(validEvm(bad), /EVM address/);
  assert.equal(validTron(TRON), null);
  assert.equal(validTron('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), null); // the USDT contract: a valid Tron address
  assert.match(validTron(TRON.slice(0, -1) + (TRON.endsWith('a') ? 'b' : 'a')), /typo|checksum/);
  for (const bad of ['', SOL, EVM, 'T' + 'a'.repeat(10), null]) assert.match(validTron(bad), /Tron/);
});

test('quote request shape: every chain differs only in the origin asset; destination, recipient and recipientType are fixed', () => {
  const base = { reserveAccount: 'reserve.acct', amountIn: 1_500_000, refundTo: 'r', deadlineMs: Date.UTC(2026, 10, 20) };
  const want = {
    'sol-usdc': 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
    'base-usdc': 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    'arb-usdc': 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    'eth-usdc': 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
    'tron-usdt': 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near',
  };
  for (const c of CHAINS) {
    const r = quoteRequest({ chain: c, ...base });
    assert.deepEqual(r, { dry: false, swapType: 'FLEX_INPUT', slippageTolerance: 100, originAsset: want[c.id], depositType: 'ORIGIN_CHAIN', destinationAsset: NEAR_USDC, amount: '1500000', refundTo: 'r', refundType: 'ORIGIN_CHAIN', recipient: 'reserve.acct', recipientType: 'CONFIDENTIAL_INTENTS', deadline: '2026-11-20T00:00:00.000Z' }, c.id);
    assert.equal(quoteRequest({ chain: c, ...base, dry: true }).dry, true);
  }
  assert.equal(NEAR_USDC, 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1');
});

test('only chains that 1Click lists are offered', () => {
  const tok = (c) => ({ assetId: c.assetId, symbol: c.symbol, decimals: 6 });
  assert.deepEqual(listedChains(CHAINS.map(tok)).map((c) => c.id), CHAINS.map((c) => c.id));
  assert.deepEqual(listedChains(CHAINS.filter((c) => c.id !== 'tron-usdt').map(tok)).map((c) => c.id), ['sol-usdc', 'base-usdc', 'arb-usdc', 'eth-usdc']);
  assert.deepEqual(listedChains([{ ...tok(CHAINS[1]), decimals: 18 }, { ...tok(CHAINS[2]), symbol: 'USDT' }]), []);
  assert.deepEqual(listedChains(null), []);
});

test('intake offers exactly what /v0/tokens lists and refuses an unlisted chain', async () => {
  const sent = [];
  const oc = async (method, path, body) => {
    sent.push({ method, path, body });
    if (path === '/v0/tokens') return { status: 200, body: CHAINS.filter((c) => c.id !== 'tron-usdt' && c.id !== 'eth-usdc').map((c) => ({ assetId: c.assetId, symbol: c.symbol, decimals: 6 })) };
    return { status: 201, body: { quote: { depositAddress: 'x', amountIn: String(body.amount), minAmountIn: '1', amountOut: String(body.amount), deadline: body.deadline } } };
  };
  const intake = makeIntake({ store: openStore(':memory:'), oc, reserveAccount: 'res', handle: 'demo' });
  assert.deepEqual((await intake.info()).chains.map((c) => c.id), ['sol-usdc', 'base-usdc', 'arb-usdc']);
  await assert.rejects(intake.quote({ chain: 'tron-usdt', amountUsdc: 5, refundTo: TRON }), /not available/);
  await assert.rejects(intake.quote({ chain: 'nope', amountUsdc: 5, refundTo: SOL }), /not available/);
  assert.equal(sent.filter((s) => s.path === '/v0/quote').length, 0, 'nothing was quoted for an unlisted chain');
});

test('routes (mock): every listed chain gets an address shaped like its chain; a refund address from another chain is refused', async () => {
  const t = await boot({ allowance: 0 });
  try {
    const info = (await t.j(t.pub, '/api/pay/demo')).body;
    assert.deepEqual(info.chains.map((c) => c.id), CHAINS.map((c) => c.id));
    const shape = { 'sol-usdc': /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'base-usdc': /^0x[0-9a-f]{40}$/, 'arb-usdc': /^0x[0-9a-f]{40}$/, 'eth-usdc': /^0x[0-9a-f]{40}$/, 'tron-usdt': /^T[1-9A-HJ-NP-Za-km-z]{33}$/ };
    for (const c of CHAINS) {
      const q = await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { chain: c.id, amountUsdc: 5, refundTo: REFUND[c.id] } });
      assert.equal(q.status, 200, c.id + ' ' + JSON.stringify(q.body));
      assert.match(q.body.address, shape[c.id], c.id);
      assert.equal(q.body.chain.id, c.id);
      assert.equal(q.body.fee, q.body.amountIn - q.body.amountOut);
      // a second ask for the same chain reuses the address; the same refund address on another chain does not
      const again = await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { chain: c.id, amountUsdc: 5, refundTo: REFUND[c.id] } });
      assert.equal(again.body.address, q.body.address);
      for (const other of CHAINS.filter((o) => c.validate(REFUND[o.id]) !== null)) {
        const bad = await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { chain: c.id, amountUsdc: 5, refundTo: REFUND[other.id] } });
        assert.equal(bad.status, 400, `${c.id} refuses ${other.id}'s address`);
        assert.match(bad.body.error, new RegExp(c.addressName.split(' ')[0]));
      }
    }
    // an address issued for Base is not handed back for Arbitrum, though the refund address is identical
    const base = await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { chain: 'base-usdc', amountUsdc: 7, refundTo: EVM } });
    const arb = await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { chain: 'arb-usdc', amountUsdc: 7, refundTo: EVM } });
    assert.notEqual(base.body.address, arb.body.address);
    // the default chain is still Solana, as before
    assert.equal((await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { amountUsdc: 5, refundTo: SOL } })).body.chain.id, 'sol-usdc');
    assert.equal((await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { chain: 'sol-usdc', amountUsdc: 5, refundTo: EVM } })).status, 400);
  } finally { t.close(); }
});

test('routes (mock): the fee and the minimum come from the quote; a payment below a chain\'s minimum gets a clear message', async () => {
  const t = await boot({ allowance: 0 });
  try {
    const est = async (chain, amountUsdc) => (await t.j(t.pub, '/api/pay/demo/estimate', { method: 'POST', body: { chain, amountUsdc } }));
    const e = await est('base-usdc', 5);
    assert.equal(e.status, 200);
    assert.equal(e.body.fee, e.body.amountIn - e.body.amountOut);
    assert.equal(e.body.minimum, 150000);
    assert.equal((await est('sol-usdc', 5)).body.minimum, 50000);
    assert.equal((await est('tron-usdt', 5)).body.minimum, 2613288);
    const low = await est('tron-usdt', 1);
    assert.equal(low.body.tooLow, true); assert.equal(low.body.minimum, 2613288); assert.match(low.body.error, /USDT on Tron is 2\.613288 USDT/);
    const q = await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { chain: 'eth-usdc', amountUsdc: 0.1, refundTo: EVM } });
    assert.equal(q.status, 400); assert.match(q.body.error, /minimum for USDC on Ethereum is 0\.300001/);
    assert.equal((await est('nope', 5)).status, 400);
    assert.equal((await est('base-usdc', 'x')).status, 400);
    const ok = await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { chain: 'base-usdc', amountUsdc: 5, refundTo: EVM } });
    assert.equal(ok.body.minimum, 150000);
  } finally { t.close(); }
});

test('a payment from every chain is detected, logged with its chain, and split exactly as a Solana payment is', async () => {
  const t = await boot({ allowance: 3_000_000 });
  try {
    const seen = [];
    for (const c of CHAINS) {
      const q = await t.j(t.pub, '/api/pay/demo/quote', { method: 'POST', body: { chain: c.id, amountUsdc: 5, refundTo: REFUND[c.id] } });
      assert.equal(q.status, 200);
      t.svc.mock.simulateDeposit(q.body.address);
      await t.settleAll(6);
      seen.push(c.id);
    }
    const ev = t.svc.store.events(500);
    const pay = ev.filter((e) => e.kind === 'payment_in');
    assert.equal(pay.length, CHAINS.length);
    assert.deepEqual(pay.map((e) => e.detail.chain).sort(), CHAINS.map((c) => c.id).sort());
    assert.deepEqual(pay.map((e) => e.detail.originChainTxHashes[0]).sort(), CHAINS.map((c) => `mock-${c.id}-tx`).sort());
    assert.equal(pay.every((e) => e.amount === 4_999_000), true);
    // the first payment fills the pocket to the 3.00 allowance (as for Solana); the reserve holds everything else, 5 x 4.999 - 3.00
    const phone = await t.j(t.pub, '/api/phone/state', { headers: { Authorization: 'Bearer mock-pocket-key' } });
    assert.equal(phone.body.pocket, 3_000_000);
    const home = await t.hj('/api/home/state');
    assert.equal(home.body.reserve, 5 * 4_999_000 - 3_000_000);
  } finally { t.close(); }
});
