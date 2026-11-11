// OutLayer client. All calls go through a `transport(auth, method, path, body, headers)` returning {status, body}.
// Live transport = fetch. The mock (server/mock.js) is a transport too, so the engine runs the same code in both modes.
import crypto from 'node:crypto';
import { signNep413 } from './nep413.js';
import { USDC_TOKEN } from './guard.js';

export function liveTransport({ base, keys }) {
  return async (auth, method, path, body, headers = {}) => {
    const key = typeof auth === 'string' ? keys[auth] : auth?.key; // 'reserve' | 'pocket' | { key } (a phone's own key, never stored)
    const h = { 'Content-Type': 'application/json', ...headers };
    if (key) h.Authorization = `Bearer ${key}`;
    const res = await fetch(base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  };
}

// Remove anything that looks like a key before it reaches a log or a response.
export const scrub = (x) => JSON.stringify(x).replace(/(wk_[A-Za-z0-9]+|Bearer\s+[^\s"]+|ed25519:[A-Za-z0-9]{60,})/g, '[REDACTED]');

export function makeOutLayer(transport, { approver, recipient = 'outlayer.near' } = {}) {
  const usdc = (balances) => BigInt((balances ?? []).find((b) => b.token === USDC_TOKEN)?.balance ?? '0');
  const ol = {
    transport,
    async policyState(role) {
      const r = await transport(role, 'GET', '/wallet/v1/policy');
      if (r.status !== 200) throw new Error(`policy read failed for ${role}: HTTP ${r.status}`);
      return { role, version: r.body.version, locked: !!r.body.locked, frozen: !!r.body.frozen, usage: r.body.usage ?? {} };
    },
    async confBalance(auth) {
      const r = await transport(auth, 'GET', '/wallet/v1/confidential/balance');
      if (r.status !== 200) { const e = new Error(`balance read failed: HTTP ${r.status} ${scrub(r.body).slice(0, 200)}`); e.status = r.status; throw e; }
      return usdc(r.body.balances);
    },
    reserveTransfer: (to, amount, idem) => transport('reserve', 'POST', '/wallet/v1/confidential/transfer', { to, token: USDC_TOKEN, amount: String(amount) }, idem ? { 'Idempotency-Key': idem } : {}),
    reserveWithdraw: (to, amount, idem) => transport('reserve', 'POST', '/wallet/v1/confidential/withdraw', { to, token: USDC_TOKEN, amount: String(amount), chain: 'near' }, idem ? { 'Idempotency-Key': idem } : {}),
    async pendingApprovals() {
      const r = await transport('reserve', 'GET', '/wallet/v1/pending_approvals');
      if (r.status !== 200) throw new Error(`pending approvals read failed: HTTP ${r.status}`);
      return r.body.approvals ?? [];
    },
    request: (auth, id) => transport(auth, 'GET', `/wallet/v1/requests/${id}`),
    // Sign and send ONE approve vote. The caller must already have persisted what the guard allowed.
    async vote(approvalId, vettedHash) {
      if (!approver) throw new Error('no approver configured');
      const d = await transport(null, 'GET', `/wallet/v1/approval/${approvalId}`);
      if (d.status !== 200) throw new Error(`approval detail failed: HTTP ${d.status}`);
      if (d.body.request_hash !== vettedHash) { const e = new Error('request_hash changed after the guard vetted it; not voting'); e.code = 'HASH_CHANGED'; throw e; }
      const nonce = crypto.randomBytes(32);
      const sig = signNep413({ seedHex: approver.seed, message: `approve:${approvalId}:${d.body.wallet_pubkey}:${d.body.request_hash}`, recipient, nonce });
      return transport(null, 'POST', `/wallet/v1/approve/${approvalId}`, { signature: sig.toString('base64'), public_key: approver.pubkey, account_id: approver.account, nonce: nonce.toString('base64') });
    },
  };
  return ol;
}

export async function settle(ol, auth, requestId, { timeoutMs = 120000, intervalMs = 2000 } = {}) {
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    const r = await ol.request(auth, requestId);
    const st = r.body?.status;
    if (r.status === 200 && st && !/pending|processing|submitted|queued/.test(st)) return { status: st, body: r.body };
    await new Promise((s) => setTimeout(s, intervalMs));
  }
  return { status: 'timeout', body: null };
}
