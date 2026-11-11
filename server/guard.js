// The guard decides which pending OutLayer approvals Carry's approver may vote on.
// It is PURE: no network, no clock, no database, no keys. Everything it needs is passed in.
// OutLayer accepts any vote from the pinned signer key, so this function is the only thing
// deciding what gets auto-approved. Default is NO VOTE; every refusal carries a code and a reason.
//
// Approves ONLY:
//   (a) a confidential TRANSFER of USDC to the pocket that keeps (pocket balance + in-flight + amount)
//       <= the phone ceiling and amount <= the remaining total-refill allowance;
//   (b) the stored bill: a confidential WITHDRAW of USDC on NEAR to the exact payee, the exact amount,
//       not yet used, before expiry.

export const USDC_TOKEN = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const PHONE_CEILING = 20_000_000n; // 20 USDC, micro-USDC

// An approval lives 24 h at OutLayer. Its vote endpoint does NOT refuse a late vote (live finding D5, 11 Nov 2026),
// so Carry never votes on an approval that has expired or is older than a few minutes.
export const APPROVAL_LIFETIME_MS = 24 * 3600e3;
export const APPROVAL_MAX_AGE_MS = 5 * 60e3;
export function checkFresh(expiresAt, now) {
  if (typeof now !== 'number') return { code: 'GUARD_ERROR', reason: 'now must be a number' };
  const exp = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(exp)) return { code: 'MALFORMED', reason: 'expires_at missing or unreadable' };
  if (now >= exp) return { code: 'APPROVAL_EXPIRED', reason: `approval expired at ${expiresAt}` };
  const age = now - (exp - APPROVAL_LIFETIME_MS);
  if (age > APPROVAL_MAX_AGE_MS) return { code: 'APPROVAL_EXPIRED', reason: `approval is ${Math.round(age / 1000)}s old (limit ${APPROVAL_MAX_AGE_MS / 1000}s)` };
  return null;
}

const OP_KEYS = new Set(['amount', 'chain', 'flow', 'kind', 'to', 'token']);
const DATA_KEYS = new Set(['amount', 'chain', 'to', 'token', 'destination_asset']);
const AMOUNT_RE = /^[1-9][0-9]{0,30}$/; // positive integer, no sign, no leading zero, no decimals

const no = (code, reason) => ({ approve: false, code, reason });

function parseAmount(s) {
  return typeof s === 'string' && AMOUNT_RE.test(s) ? BigInt(s) : null;
}

/**
 * @param {object} approval  a pending approval as returned by OutLayer (type, request_data, op, request_hash, approval_id)
 * @param {object} ctx
 *   pocketAccount: string
 *   pocketBalance: bigint   the pocket's REAL confidential USDC balance (micro)
 *   inFlight: bigint        refills already approved but not yet settled (micro), default 0n
 *   allowance: bigint       remaining total-refill allowance (micro)
 *   ceiling: bigint         phone ceiling (micro), default PHONE_CEILING
 *   bills: [{id, payee, amount: string, expiresAt: number(ms), used: boolean}]
 *   now: number (ms)
 * @returns {{approve:boolean, code:string, reason:string, kind?:string, consume?:object, requestHash?:string, approvalId?:string}}
 */
export function decide(approval, ctx) {
  try {
    return decideInner(approval, ctx);
  } catch (e) {
    return no('GUARD_ERROR', `guard failed closed: ${e.message}`);
  }
}

function decideInner(approval, ctx) {
  if (!approval || typeof approval !== 'object') return no('MALFORMED', 'no approval object');
  const { type, request_data: data, op, request_hash: hash, approval_id: id } = approval;
  if (typeof id !== 'string' || typeof hash !== 'string' || !id || !hash) return no('MALFORMED', 'missing approval_id or request_hash');
  if (type !== 'confidential') return no('WRONG_TYPE', `type is "${type}", only "confidential" can be approved`);
  if (!op || typeof op !== 'object') return no('NO_OP', 'canonical op missing; cannot verify what is being approved');
  if (!data || typeof data !== 'object') return no('MALFORMED', 'request_data missing');
  for (const k of Object.keys(op)) if (!OP_KEYS.has(k)) return no('UNEXPECTED_FIELD', `op has unexpected field "${k}"`);
  for (const k of Object.keys(data)) if (!DATA_KEYS.has(k)) return no('UNEXPECTED_FIELD', `request_data has unexpected field "${k}"`);
  if (op.kind !== 'confidential') return no('WRONG_KIND', `op.kind is "${op.kind}"`);
  if (op.token !== USDC_TOKEN) return no('WRONG_TOKEN', `token ${op.token} is not NEAR USDC`);
  if (op.chain !== 'near') return no('WRONG_CHAIN', `chain is "${op.chain}", only near`);
  const amount = parseAmount(op.amount);
  if (amount === null) return no('BAD_AMOUNT', `amount "${op.amount}" is not a positive integer`);
  if (typeof op.to !== 'string' || !op.to) return no('MALFORMED', 'op.to missing');
  // request_data and op must agree (op is what the request hash covers).
  if (data.to !== op.to || data.amount !== op.amount || data.token !== op.token) return no('DATA_MISMATCH', 'request_data does not match op');
  if (data.chain !== undefined && data.chain !== op.chain) return no('DATA_MISMATCH', 'request_data.chain does not match op');
  if (data.destination_asset !== undefined && data.destination_asset !== USDC_TOKEN) return no('WRONG_TOKEN', 'destination_asset is not NEAR USDC');

  const stale = checkFresh(approval.expires_at, ctx?.now);
  if (stale) return no(stale.code, stale.reason);
  const base = { requestHash: hash, approvalId: id };
  if (op.flow === 'transfer') return { ...refill(op, amount, ctx), ...base };
  if (op.flow === 'withdraw') return { ...bill(op, amount, data, ctx), ...base };
  return no('WRONG_FLOW', `flow "${op.flow}" is neither a refill (transfer) nor a bill (withdraw)`);
}

function refill(op, amount, ctx) {
  if (op.to !== ctx.pocketAccount) return no('REFILL_NOT_POCKET', `transfer to ${op.to} is not the pocket`);
  const ceiling = ctx.ceiling ?? PHONE_CEILING;
  const inFlight = ctx.inFlight ?? 0n;
  if (typeof ctx.pocketBalance !== 'bigint' || typeof ctx.allowance !== 'bigint') return no('GUARD_ERROR', 'pocketBalance and allowance must be bigint');
  if (amount > ctx.allowance) return no('OVER_ALLOWANCE', `refill ${amount} > remaining total-refill allowance ${ctx.allowance}`);
  if (ctx.pocketBalance + inFlight + amount > ceiling) return no('OVER_CEILING', `pocket ${ctx.pocketBalance} + in flight ${inFlight} + refill ${amount} > phone ceiling ${ceiling}`);
  return { approve: true, code: 'REFILL_OK', reason: 'refill to pocket within ceiling and allowance', kind: 'refill', consume: { allowance: amount } };
}

function bill(op, amount, data, ctx) {
  const now = ctx.now;
  if (typeof now !== 'number') return no('GUARD_ERROR', 'now must be a number');
  if (op.to === ctx.pocketAccount) return no('WITHDRAW_TO_POCKET', 'withdraws are only for the stored bill; refills are transfers');
  const forPayee = (ctx.bills ?? []).filter((b) => b.payee === op.to);
  if (forPayee.length === 0) return no('BILL_UNKNOWN_PAYEE', `no stored bill for payee ${op.to}`);
  const exact = forPayee.filter((b) => b.amount === op.amount);
  if (exact.length === 0) return no('BILL_AMOUNT_MISMATCH', `amount ${op.amount} differs from the stored bill amount`);
  const open = exact.filter((b) => !b.used);
  if (open.length === 0) return no('BILL_USED', 'the stored bill was already paid');
  const live = open.filter((b) => now < b.expiresAt);
  if (live.length === 0) return no('BILL_EXPIRED', 'the stored bill has expired');
  return { approve: true, code: 'BILL_OK', reason: 'stored bill: exact payee, exact amount, unused, not expired', kind: 'bill', consume: { billId: live[0].id } };
}
