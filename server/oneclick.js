// 1Click (NEAR Intents) client with the partner key. Live transport = fetch; mock transport lives in mock.js.
export const SOL_USDC = 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near';
export const NEAR_USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

export function liveOneClick({ apiKey, base = 'https://1click.chaindefuser.com' }) {
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, body: j };
  };
}

// A deposit address for ONE payment: Solana USDC in -> reserve's CONFIDENTIAL balance. No reserve key involved.
export async function issueQuote(oc, { reserveAccount, amountIn, refundTo, deadlineMs }) {
  const r = await oc('POST', '/v0/quote', {
    dry: false, swapType: 'FLEX_INPUT', slippageTolerance: 100,
    originAsset: SOL_USDC, depositType: 'ORIGIN_CHAIN', destinationAsset: NEAR_USDC,
    amount: String(amountIn), refundTo, refundType: 'ORIGIN_CHAIN',
    recipient: reserveAccount, recipientType: 'CONFIDENTIAL_INTENTS',
    deadline: new Date(deadlineMs).toISOString(),
  });
  const q = r.body?.quote;
  if (r.status !== 201 || !q?.depositAddress) { const e = new Error(`1Click quote failed: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); e.status = r.status; throw e; }
  return { address: q.depositAddress, amountIn: Number(q.amountIn), minAmountIn: Number(q.minAmountIn ?? q.amountIn), amountOut: Number(q.amountOut), deadline: q.deadline ?? new Date(deadlineMs).toISOString() };
}

export async function getStatus(oc, address) {
  const r = await oc('GET', `/v0/status?depositAddress=${encodeURIComponent(address)}`);
  if (r.status !== 200) return { status: 'UNKNOWN', http: r.status };
  const d = r.body.swapDetails ?? {};
  return { status: r.body.status, amountOut: d.amountOut ? Number(d.amountOut) : null, amountIn: d.amountIn ? Number(d.amountIn) : null, nearTxHashes: d.nearTxHashes, originChainTxHashes: d.originChainTxHashes };
}
