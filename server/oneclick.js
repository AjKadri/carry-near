// 1Click (NEAR Intents) client with the partner key. Live transport = fetch; mock transport lives in mock.js.
export const NEAR_USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

export function liveOneClick({ apiKey, base = 'https://1click.chaindefuser.com' }) {
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, body: j };
  };
}

// 1Click's own list of tradable assets; decides which source chains the pay link offers.
export async function fetchTokens(oc) {
  const r = await oc('GET', '/v0/tokens');
  if (r.status !== 200 || !Array.isArray(r.body)) throw new Error(`1Click /v0/tokens failed: HTTP ${r.status}`);
  return r.body;
}

// The exact /v0/quote request for one payment: USDC or USDT on a source chain -> USDC in the reserve's CONFIDENTIAL balance.
// Same for every chain except the origin asset; the destination, recipient and recipientType never change. No reserve key involved.
export function quoteRequest({ chain, reserveAccount, amountIn, refundTo, deadlineMs, dry = false }) {
  return {
    dry, swapType: 'FLEX_INPUT', slippageTolerance: 100,
    originAsset: chain.assetId, depositType: 'ORIGIN_CHAIN', destinationAsset: NEAR_USDC,
    amount: String(amountIn), refundTo, refundType: 'ORIGIN_CHAIN',
    recipient: reserveAccount, recipientType: 'CONFIDENTIAL_INTENTS',
    deadline: new Date(deadlineMs).toISOString(),
  };
}

const num = (x) => (x == null ? null : Number(x));
const quoteView = (q, deadlineMs) => ({ address: q.depositAddress ?? null, amountIn: Number(q.amountIn), minAmountIn: Number(q.minAmountIn ?? q.amountIn), amountOut: Number(q.amountOut), minAmountOut: num(q.minAmountOut), amountInUsd: num(q.amountInUsd), amountOutUsd: num(q.amountOutUsd), timeEstimate: num(q.timeEstimate), deadline: q.deadline ?? new Date(deadlineMs).toISOString() });

export async function issueQuote(oc, args) {
  const r = await oc('POST', '/v0/quote', quoteRequest({ ...args, dry: false }));
  const q = r.body?.quote;
  if (r.status !== 201 || !q?.depositAddress) { const e = new Error(`1Click quote failed: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); e.status = r.status; e.body = r.body; throw e; }
  return quoteView(q, args.deadlineMs);
}

// A dry quote: no deposit address, nothing reserved, no money moves. Used for the minimum and fee shown before the payer commits.
export async function dryQuote(oc, args) {
  const r = await oc('POST', '/v0/quote', quoteRequest({ ...args, dry: true }));
  const q = r.body?.quote;
  if (r.status !== 200 && r.status !== 201) { const e = new Error(`1Click quote failed: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); e.status = r.status; e.body = r.body; throw e; }
  if (!q) throw new Error('1Click dry quote had no quote');
  return quoteView(q, args.deadlineMs);
}

export async function getStatus(oc, address) {
  const r = await oc('GET', `/v0/status?depositAddress=${encodeURIComponent(address)}`);
  if (r.status !== 200) return { status: 'UNKNOWN', http: r.status };
  const d = r.body.swapDetails ?? {};
  return { status: r.body.status, amountOut: d.amountOut ? Number(d.amountOut) : null, amountIn: d.amountIn ? Number(d.amountIn) : null, nearTxHashes: d.nearTxHashes, originChainTxHashes: d.originChainTxHashes };
}
