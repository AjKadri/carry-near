// In-memory stand-in for OutLayer and 1Click. It speaks the same request/response shapes as the real APIs
// (copied from the mainnet runs in SPIKE.md), including strict NEP-413 vote checks, so the engine runs identical code.
// It is NOT the real network: nothing here proves anything about mainnet.
import crypto from 'node:crypto';
import { USDC_TOKEN } from './guard.js';
import { verifyNep413, newKey, b58enc } from './nep413.js';

const uuid = () => crypto.randomUUID();
export const MOCK_POCKET_ACCOUNT = '96cb4ed480cb63a7e7dfe95ba52fcd96d87e10eb2f1ae2e4630985c1fb086c5f';
export const MOCK_RESERVE_ACCOUNT = '61ffccb371b88a88407c527f0e0fcc4b2e52d1253668a60d9199382c34beebea';
export const MOCK_LANDLORD = 'd7041ab1063b3f017ae4d43857b225c2897b0d39682cbd2048c539a04b4805a4';
export const MOCK_EXIT = 'nearhacka.near';
export const MOCK_POCKET_KEY = 'mock-pocket-key';

export function createMock({ now = Date.now, settleDelayMs = 1500, tweakApproval = (a) => a } = {}) {
  const approver = newKey();
  const wallet_pubkey = 'ed25519:' + b58enc(crypto.randomBytes(32));
  const bal = { reserve: 0n, pocket: 0n };
  const usage = { reserve: 0n, pocket: 0n };
  const limits = { reserve: { tx: 20_000_000n, day: 60_000_000n }, pocket: { tx: 10_000_000n, day: 20_000_000n } };
  const whitelist = { reserve: new Set([MOCK_POCKET_ACCOUNT, MOCK_LANDLORD, MOCK_EXIT]), pocket: null };
  const reqs = new Map(), approvals = new Map(), idem = new Map();
  const m = { approver, state: { frozen: false }, bal, reqs, approvals };
  const roleOf = (auth) => (auth === 'reserve' ? 'reserve' : auth === 'pocket' || auth?.key === MOCK_POCKET_KEY ? 'pocket' : null);
  const deny = (message) => ({ status: 403, body: { error: 'policy_denied', message } });

  function execute(r) { // move the money
    const from = r.role;
    bal[from] -= r.amount; usage[from] += r.amount;
    if (r.flow === 'transfer' && r.to === MOCK_POCKET_ACCOUNT) bal.pocket += r.amount;
    r.status = 'success'; r.result = { amount: String(r.amount), recipient: r.to, submitted: true };
  }
  function moneyOp(role, flow, body, headers) {
    if (headers['Idempotency-Key'] && idem.has(headers['Idempotency-Key'])) return idem.get(headers['Idempotency-Key']);
    if (m.state.frozen && role === 'pocket') return { status: 403, body: { error: 'wallet_frozen', message: 'Wallet is frozen by controller' } };
    if (body.token !== USDC_TOKEN) return deny(`Token '${body.token}' is not allowed by policy`);
    if (!/^[1-9][0-9]*$/.test(String(body.amount))) return { status: 400, body: { error: 'bad_request', message: 'bad amount' } };
    const amount = BigInt(body.amount), l = limits[role];
    if (whitelist[role] && !whitelist[role].has(body.to)) return deny(`Address '${body.to}' is not in whitelist`);
    if (amount > l.tx) return deny(`Per-transaction limit exceeded for ${USDC_TOKEN}: ${amount} > ${l.tx}`);
    if (usage[role] + amount > l.day) return deny(`Daily limit exceeded for ${USDC_TOKEN}: ${usage[role]} + ${amount} > ${l.day}`);
    if (bal[role] < amount) return { status: 400, body: { error: 'insufficient_balance', message: 'insufficient confidential balance' } };
    const r = { id: uuid(), role, flow, to: body.to, amount, status: 'pending', result: null };
    reqs.set(r.id, r);
    let out;
    if (role === 'reserve') { // every reserve op waits for approval, like the locked mainnet policy
      const op = { amount: String(amount), chain: 'near', flow, kind: 'confidential', to: body.to, token: USDC_TOKEN };
      const hash = crypto.createHash('sha256').update(JSON.stringify(op) + r.id).digest('hex');
      const a = { approval_id: uuid(), request_id: r.id, type: 'confidential', request_data: flow === 'withdraw' ? { to: body.to, chain: 'near', token: USDC_TOKEN, amount: String(amount), destination_asset: USDC_TOKEN } : { to: body.to, token: USDC_TOKEN, amount: String(amount) }, op, request_hash: hash, decision: 'requires_approval', required: 1, approved: 0, status: 'pending', expires_at: new Date(now() + 86400e3).toISOString() };
      approvals.set(a.approval_id, a); r.approval = a;
      out = { status: 200, body: { request_id: r.id, status: 'pending_approval', approval_id: a.approval_id, required: 1, approved: 0, request_hash: hash } };
    } else { r.doneAt = now() + settleDelayMs; bal.pocket -= amount; usage.pocket += amount; r.status = 'processing'; out = { status: 200, body: { request_id: r.id, status: 'pending_deposit' } }; }
    if (headers['Idempotency-Key']) idem.set(headers['Idempotency-Key'], out);
    return out;
  }
  function vote(id, body) {
    const a = approvals.get(id);
    if (!a) return { status: 404, body: { error: 'not_found' } };
    if (a.status !== 'pending') return { status: 409, body: { error: 'conflict', message: `this approval is already ${a.status}; it takes no more votes` } };
    if (body.account_id !== approver.account) return { status: 403, body: { error: 'not_approver', message: `${body.account_id} is not an approver of this wallet's policy` } };
    if (body.public_key !== approver.pubkey) return { status: 401, body: { error: 'invalid_signature', message: `public key ${body.public_key} is not a key of ${body.account_id}` } };
    const ok = verifyNep413({ pubkey: body.public_key, message: `approve:${id}:${wallet_pubkey}:${a.request_hash}`, recipient: 'outlayer.near', nonce: Buffer.from(body.nonce, 'base64'), signature: Buffer.from(body.signature, 'base64') });
    if (!ok) return { status: 401, body: { error: 'invalid_signature', message: 'NEP-413 signature verification failed' } };
    a.status = 'approved'; a.approved = 1;
    const r = reqs.get(a.request_id); r.status = 'processing'; r.doneAt = now() + settleDelayMs;
    return { status: 200, body: { approval_id: id, status: 'approved', approved: 1, required: 1, request_id: a.request_id } };
  }
  function tick() { // settle processing requests whose time has come
    for (const r of reqs.values()) if (r.status === 'processing' && r.doneAt <= now()) { if (r.role === 'reserve') execute(r); else { r.status = 'success'; r.result = { amount: String(r.amount), recipient: r.to, submitted: true }; } }
  }
  m.transport = async (auth, method, path, body, headers = {}) => {
    tick();
    const role = roleOf(auth);
    let mt;
    if (method === 'GET' && path === '/wallet/v1/policy') return role ? { status: 200, body: { version: role === 'reserve' ? 2 : 4, locked: true, frozen: role === 'pocket' && m.state.frozen, usage: {} } } : { status: 401, body: { error: 'unauthorized' } };
    if (method === 'GET' && path === '/wallet/v1/confidential/balance') return role ? { status: 200, body: { balances: [{ token: USDC_TOKEN, balance: String(bal[role]) }] } } : { status: 401, body: { error: 'unauthorized' } };
    if (method === 'POST' && (mt = path.match(/^\/wallet\/v1\/confidential\/(transfer|withdraw)$/))) return role ? moneyOp(role, mt[1], body, headers) : { status: 401, body: { error: 'unauthorized' } };
    if (method === 'GET' && path === '/wallet/v1/pending_approvals') return role === 'reserve' ? { status: 200, body: { approvals: [...approvals.values()].filter((a) => a.status === 'pending').map(({ status, ...a }) => tweakApproval(structuredClone(a))) } } : { status: 401, body: { error: 'unauthorized' } };
    if (method === 'GET' && (mt = path.match(/^\/wallet\/v1\/approval\/(.+)$/))) { const a = approvals.get(mt[1]); return a ? { status: 200, body: { id: a.approval_id, wallet_pubkey, request_hash: a.request_hash, status: a.status } } : { status: 404, body: { error: 'not_found' } }; }
    if (method === 'POST' && (mt = path.match(/^\/wallet\/v1\/approve\/(.+)$/))) return vote(mt[1], body ?? {});
    if (method === 'GET' && (mt = path.match(/^\/wallet\/v1\/requests\/(.+)$/))) { const r = reqs.get(mt[1]); return r ? { status: 200, body: { request_id: r.id, status: r.status === 'pending' ? 'pending_approval' : r.status, result: r.result } } : { status: 404, body: { error: 'not_found' } }; }
    return { status: 404, body: { error: 'not_found', message: 'Unknown endpoint' } };
  };

  // ---- mock 1Click
  const quotes = new Map();
  m.credit = (amount) => { bal.reserve += BigInt(amount); };
  m.oneClick = async (method, path, body) => {
    let mt;
    if (method === 'POST' && path === '/v0/quote') {
      const address = b58enc(crypto.randomBytes(32)), amountIn = Number(body.amount);
      const q = { address, amountIn, amountOut: Math.round(amountIn * 0.9998), deadline: body.deadline, status: 'PENDING_DEPOSIT', successAt: null };
      quotes.set(address, q);
      return { status: 201, body: { quote: { depositAddress: address, amountIn: String(amountIn), minAmountIn: String(Math.round(amountIn * 0.99)), amountOut: String(q.amountOut), deadline: q.deadline } } };
    }
    if (method === 'GET' && (mt = path.match(/^\/v0\/status\?depositAddress=(.+)$/))) {
      const q = quotes.get(decodeURIComponent(mt[1]));
      if (!q) return { status: 404, body: { message: 'deposit address not found' } };
      if (q.status === 'PROCESSING' && q.successAt <= now()) { q.status = 'SUCCESS'; m.credit(q.amountOut); }
      return { status: 200, body: { status: q.status, swapDetails: q.status === 'SUCCESS' ? { amountIn: String(q.amountIn), amountOut: String(q.amountOut), originChainTxHashes: ['mock-solana-tx'], nearTxHashes: ['mock-near-tx'] } : {} } };
    }
    return { status: 404, body: {} };
  };
  m.simulateDeposit = (address) => { const q = quotes.get(address); if (!q || q.status !== 'PENDING_DEPOSIT') return false; q.status = 'PROCESSING'; q.successAt = now() + settleDelayMs; return true; };
  return m;
}
