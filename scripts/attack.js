// npm run attack            mock mode: replays the cases against an in-process mock of OutLayer and 1Click (free)
// npm run attack -- --live --yes   live mode: the same cases against the real locked mainnet wallets, tiny amounts
//
// One line per case: PASS | FAIL | SKIP | INFO | FINDING  --  id  --  case  --  raw refusal.
// Every refused service-side case also prints proof that the request stayed pending and balances did not change.
// Afterwards the approver REJECTS the attacker's request so no stray approvals are left.
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { loadConfig, requireLive } from '../server/config.js';
import { createServices } from '../server/services.js';
import { createHomeApp, createPublicApp } from '../server/app.js';
import { decide, USDC_TOKEN } from '../server/guard.js';
import { signNep413, newKey } from '../server/nep413.js';
import { scrub } from '../server/outlayer.js';
import { MOCK_POCKET_KEY, MOCK_LANDLORD, MOCK_EXIT } from '../server/mock.js';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
if (LIVE && !args.includes('--yes')) { console.error('Live mode moves real (tiny) money. Re-run with: npm run attack -- --live --yes'); process.exit(2); }
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7).split(',') ?? null; // e.g. --only=B5,B7,B8 (used to resume a live run without repeating cases)
const SPEND_CAP = 250_000; // micro-USDC, everything counted (our moves + the owner's payment)
const WAIT = LIVE ? 4000 : 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REFUND = '7puyGCiSnh55z3EzWEr8MKDBw9FYH2izq4K4mXPNpcuo';
const out = [];
const say = (s) => { console.log(s); out.push(s); };
const results = [];
let spent = 0;
const spend = (n, why) => { spent += n; say(`   (live spend counter: +${n / 1e6} USDC for ${why}; total ${spent / 1e6} of ${SPEND_CAP / 1e6})`); if (spent > SPEND_CAP) throw new Error('spend cap exceeded, aborting'); };

// ---------- environment
async function buildEnv({ mockOpts = {}, topUpMs = 3600e3 } = {}) {
  let skew = 0;
  const now = () => Date.now() + skew;
  const config = LIVE
    ? loadConfig({ CARRY_MODE: 'live', CARRY_DB: 'data/attack-live.db', CARRY_TOPUP_MS: String(topUpMs) })
    : loadConfig({ CARRY_MODE: 'mock', CARRY_DB: ':memory:', CARRY_TOPUP_MS: String(topUpMs) });
  if (LIVE) { for (const f of ['data/attack-live.db', 'data/attack-live.db-wal', 'data/attack-live.db-shm']) fs.rmSync(f, { force: true }); requireLive(config); }
  const svc = createServices(config, { now, mockOpts: { settleDelayMs: 40, ...mockOpts }, settleOpts: { intervalMs: LIVE ? 2000 : 20, timeoutMs: LIVE ? 120000 : 5000 } });
  const wallets = await svc.start();
  const servers = [];
  const listen = async (app) => { const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r)); servers.push(s); return `http://127.0.0.1:${s.address().port}`; };
  const env = {
    svc, config, wallets, now, ol: svc.ol, store: svc.store, mock: svc.mock,
    skew: (ms) => { skew += ms; }, resetSkew: () => { skew = 0; },
    pocketAccount: svc.pocketAccount, reserveAccount: svc.reserveAccount,
    landlord: MOCK_LANDLORD, exit: MOCK_EXIT,
    pocketAuth: LIVE ? { key: config.live.pocketKey } : { key: MOCK_POCKET_KEY },
    approver: LIVE ? config.live.approver : svc.mock.approver,
    pub: await listen(createPublicApp(svc)), home: await listen(createHomeApp(svc)),
    close: () => { servers.forEach((s) => s.close()); },
  };
  env.fetchJ = async (base, p, init = {}) => {
    const r = await fetch(base + p, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, body: init.body && typeof init.body !== 'string' ? JSON.stringify(init.body) : init.body });
    const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, body, text };
  };
  return env;
}

// ---------- helpers
const snap = async (e) => ({ reserve: await e.ol.confBalance('reserve'), pocket: await e.ol.confBalance('pocket'), allowance: e.store.allowance(), bills: JSON.stringify(e.store.bills()) });
const same = (a, b) => a.reserve === b.reserve && a.pocket === b.pocket && a.allowance === b.allowance && a.bills === b.bills;
const fmt = (s) => `reserve ${s.reserve}, pocket ${s.pocket}`;
const added = (a, b) => [...b].filter((x) => !a.has(x)).length; // ids that appeared (robust if the API caps the list)
const reqIds = async (e) => new Set(((await e.ol.transport('reserve', 'GET', '/wallet/v1/requests')).body?.requests ?? []).map((r) => r.request_id));
const raw = (r) => scrub(r.body ?? r).slice(0, 260);
const ctxNow = async (e, over = {}) => ({ pocketAccount: e.pocketAccount, pocketBalance: await e.ol.confBalance('pocket'), inFlight: 0n, ceiling: e.store.ceiling(), allowance: e.store.allowance(), bills: e.store.bills(), now: e.now(), ...over });
const pocketOp = (e, path, body) => e.ol.transport(e.pocketAuth, 'POST', path, body);
const PASS = (detail) => ({ status: 'PASS', detail }), FAIL = (detail) => ({ status: 'FAIL', detail }), SKIP = (detail) => ({ status: 'SKIP', detail }), INFO = (detail) => ({ status: 'INFO', detail });
const expectRefusal = (r, re, extra = '') => (r.status >= 400 && re.test(JSON.stringify(r.body)) ? PASS(`HTTP ${r.status} ${raw(r)}${extra}`) : FAIL(`expected a refusal matching ${re}, got HTTP ${r.status} ${raw(r)}`));

async function castVote(e, creds, id, { kind = 'approve', wrongSign = false } = {}) {
  const d = (await e.ol.transport(null, 'GET', `/wallet/v1/approval/${id}`)).body;
  const nonce = crypto.randomBytes(32);
  const sig = signNep413({ seedHex: creds.seed, message: `${kind}:${id}:${d.wallet_pubkey}:${d.request_hash}`, recipient: 'outlayer.near', nonce });
  return e.ol.transport(null, 'POST', `/wallet/v1/${kind}/${id}`, { signature: sig.toString('base64'), public_key: creds.pubkey, account_id: creds.account, nonce: nonce.toString('base64') });
}
const rejectIt = async (e, approvalId) => { const r = await castVote(e, e.approver, approvalId, { kind: 'reject' }); return `${r.status} ${r.body?.status ?? raw(r)}`; };

// A refused service-side case: a leaked reserve key makes the request, the guard decides, nothing may move.
async function guardRefusal(e, makeReq, expectCode) {
  const before = await snap(e);
  const res = await makeReq();
  if (res.status !== 200 || res.body?.status !== 'pending_approval') return FAIL(`request was not left pending: HTTP ${res.status} ${raw(res)}`);
  const approval = (await e.ol.pendingApprovals()).find((a) => a.approval_id === res.body.approval_id);
  const d = decide(approval, await ctxNow(e));
  await sleep(WAIT);
  const st = await e.ol.request('reserve', res.body.request_id);
  const after = await snap(e);
  const cleaned = await rejectIt(e, res.body.approval_id);
  const okGuard = !d.approve && d.code === expectCode;
  const okProof = st.body?.status === 'pending_approval' && same(before, after);
  return (okGuard && okProof ? PASS : FAIL)(`guard: ${d.code} (${d.reason}) | proof: request ${st.body?.status}, ${fmt(before)} -> ${fmt(after)} | cleanup: approver reject -> ${cleaned}`);
}

function spikeCreds() { // SPIKE6's signer: a real full-access key on chain that is NOT an approver of the reserve
  try {
    const t = fs.readFileSync('../carry-spike/.env', 'utf8'); const g = (k) => t.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1];
    return g('APPROVER_ACCOUNT') && g('APPROVER_SEED') ? { account: g('APPROVER_ACCOUNT'), pubkey: g('APPROVER_PUBKEY'), seed: g('APPROVER_SEED') } : null;
  } catch { return null; }
}

async function runCase(id, name, fn) {
  if (ONLY && !ONLY.includes(id)) return { status: 'SKIPPED_BY_FLAG' };
  let r;
  try { r = await fn(); } catch (err) { r = FAIL(`threw: ${scrub(err.message)}`); }
  results.push({ id, ...r });
  say(`${r.status} — ${id} — ${name} — ${r.detail}`);
  return r;
}
function suppressTimer(e) { // isolate the arrival trigger: mark the timer's buckets as already handled
  const b = Math.floor(e.now() / e.config.topUpEveryMs);
  for (const k of [b - 1, b, b + 1, b + 2]) { const key = `timer-${k}`; if (!e.store.refillByKey(key)) { e.store.createRefill({ key, arrival: null, amount: 0 }); e.store.updateRefill(e.store.refillByKey(key).id, { state: 'skipped' }); } }
}
async function ticks(e, n = 12, gap = LIVE ? 2500 : 80) { for (let i = 0; i < n; i++) { await e.svc.tick(); await sleep(gap); } }
const rows = (e, sql, ...a) => e.store.raw.prepare(sql).all(...a);

// ============================================================ main
say(`# Carry attack run — ${LIVE ? 'LIVE (mainnet, locked wallets, tiny amounts)' : 'MOCK (in-process stand-in for OutLayer and 1Click; replays recorded shapes, NOT mainnet)'} — ${new Date().toISOString()}`);
const E = await buildEnv();
say(`# wallets at start: ${E.wallets}`);
if (LIVE) {
  if (!/reserve v\d+ locked=true/.test(E.wallets) || !/pocket v\d+ locked=true/.test(E.wallets)) { say('ABORT: a wallet is not locked'); process.exit(3); }
  if (!/frozen=false \| pocket v\d+ locked=true frozen=false/.test(E.wallets)) { say('ABORT: a wallet is frozen'); process.exit(3); }
} else { // give the mock something to attack
  E.mock.credit(30_000_000); E.mock.bal.pocket = 5_000_000n;
}
E.store.setAllowance(0n);
const startSnap = await snap(E);
say(`# start balances: ${fmt(startSnap)}`);
const BILL_PAY = 20_000, BILL_OLD = 10_000;

// ---------------- phone side (pocket key only)
await runCase('A1', 'phone sends 11 USDC (per-tx cap 10)', async () => expectRefusal(await pocketOp(E, '/wallet/v1/confidential/withdraw', { token: USDC_TOKEN, amount: '11000000', to: E.landlord, chain: 'near' }), /Per-transaction limit exceeded/));
await runCase('A2', 'phone confidential transfer of 11 USDC', async () => expectRefusal(await pocketOp(E, '/wallet/v1/confidential/transfer', { token: USDC_TOKEN, amount: '11000000', to: E.landlord }), /Per-transaction limit exceeded/));
await runCase('A3', 'phone withdraws another token (wNEAR)', async () => expectRefusal(await pocketOp(E, '/wallet/v1/confidential/withdraw', { token: 'nep141:wrap.near', amount: '1000', to: E.landlord, chain: 'near' }), /not allowed/));
await runCase('A4', 'phone tries call, native transfer, public withdraw, intents transfer', async () => {
  if (!LIVE) return SKIP('not modelled by the mock; run live');
  const tries = [['call', '/wallet/v1/call', { receiver_id: USDC_TOKEN.replace('nep141:', ''), method_name: 'ft_transfer', args: { receiver_id: E.landlord, amount: '1' }, deposit: '1' }], ['transfer', '/wallet/v1/transfer', { to: E.landlord, amount: '1' }], ['withdraw', '/wallet/v1/intents/withdraw', { token: USDC_TOKEN, amount: '10000', to: E.landlord, chain: 'near' }], ['intents_transfer', '/wallet/v1/intents/transfer', { to: E.landlord, token: USDC_TOKEN, amount: '10000' }]];
  const lines = []; let ok = true;
  for (const [n, p, b] of tries) { const r = await pocketOp(E, p, b); const good = r.status === 403 && /not allowed/.test(JSON.stringify(r.body)); ok = ok && good; lines.push(`${n}: HTTP ${r.status} ${raw(r).slice(0, 90)}`); }
  return (ok ? PASS : FAIL)(lines.join(' | '));
});
await runCase('A5', 'phone hits the daily cap (20 USDC)', async () => {
  if (LIVE) return INFO('not re-run live (needs 20 USDC). T7b showed a USDC daily cap refusing live: "Daily limit exceeded … 300000 + 20000 > 300000" (SPIKE.md)');
  E.mock.bal.pocket = 30_000_000n;
  for (const a of [10, 10]) { const r = await pocketOp(E, '/wallet/v1/confidential/withdraw', { token: USDC_TOKEN, amount: String(a * 1e6), to: E.landlord, chain: 'near' }); if (r.status !== 200) return FAIL(`setup send refused: ${raw(r)}`); }
  const r = await pocketOp(E, '/wallet/v1/confidential/withdraw', { token: USDC_TOKEN, amount: '1000000', to: E.landlord, chain: 'near' });
  E.mock.bal.pocket = 5_000_000n;
  return expectRefusal(r, /Daily limit exceeded/);
});
await runCase('A6', 'phone mints a sub-key: it must be an empty, separate wallet', async () => {
  if (!LIVE) return SKIP('not modelled by the mock; run live');
  const sub = 'wk_' + crypto.randomBytes(32).toString('hex'), hash = crypto.createHash('sha256').update(sub).digest('hex');
  const mint = await E.ol.transport(E.pocketAuth, 'PUT', '/wallet/v1/api-key', { seed: `attack-${Date.now()}`, key_hash: hash });
  const addr = await E.ol.transport({ key: sub }, 'GET', '/wallet/v1/address?chain=near');
  const acct = addr.body?.address || addr.body?.account_id || mint.body?.near_account_id;
  const bal = await E.ol.confBalance({ key: sub }).catch(() => 'unreadable');
  const pocketAfter = await E.ol.confBalance('pocket');
  const ok = mint.status === 200 && acct && acct !== E.pocketAccount && bal === 0n && pocketAfter === startSnap.pocket;
  return (ok ? PASS : FAIL)(`mint HTTP ${mint.status}; sub-key account ${String(acct).slice(0, 10)}… ≠ pocket ${E.pocketAccount.slice(0, 10)}…; sub confidential balance ${bal}; pocket balance unchanged ${pocketAfter}`);
});
await runCase('A7', 'phone tries to read "the reserve" with the pocket key', async () => {
  const r = await E.ol.transport(E.pocketAuth, 'GET', '/wallet/v1/confidential/balance');
  const bal = BigInt(r.body?.balances?.find((b) => b.token === USDC_TOKEN)?.balance ?? '0'), acct = r.body?.account_id;
  const s = await snap(E);
  const ok = r.status === 200 && bal === s.pocket && (!acct || acct !== E.reserveAccount) && s.reserve !== s.pocket;
  return (ok ? PASS : FAIL)(`pocket key sees its own account ${String(acct).slice(0, 10)}… and balance ${bal}; the reserve (${s.reserve}) is not reachable with it`);
});
await runCase('A8', 'phone routes with a missing or wrong key', async () => {
  const bodies = []; let ok = true;
  for (const [m, p, h, b] of [['GET', '/api/phone/state', {}, undefined], ['GET', '/api/phone/state', { Authorization: 'Bearer wk_wrong' }, undefined], ['POST', '/api/phone/send', {}, { to: E.landlord, amountUsdc: 1 }], ['POST', '/api/phone/send', { Authorization: 'Bearer wk_wrong' }, { to: E.landlord, amountUsdc: 1 }]]) {
    const r = await E.fetchJ(E.pub, p, { method: m, headers: h, body: b }); ok = ok && r.status === 401 && r.text === '{"error":"unauthorized"}'; bodies.push(`${r.status} ${r.text}`);
  }
  return (ok ? PASS : FAIL)(bodies[0] + ' (×4 identical)');
});
await runCase('A9', 'phone sends while the pocket is frozen', async () => {
  if (LIVE) return SKIP('not repeated live (shown in T7: 403 wallet_frozen); mock only');
  E.mock.state.frozen = true;
  const r = await E.fetchJ(E.pub, '/api/phone/send', { method: 'POST', headers: { Authorization: `Bearer ${MOCK_POCKET_KEY}` }, body: { to: E.landlord, amountUsdc: 1 } });
  E.mock.state.frozen = false;
  return expectRefusal(r, /wallet_frozen/);
});

// ---------------- the phone cannot steer the guard
E.store.setAllowance(5_000n);
E.store.createBill({ id: 'atk-rent', label: 'rent', payee: E.landlord, amount: BILL_PAY, expiresAt: E.now() + 3600e3 });
E.store.createBill({ id: 'atk-old', label: 'old', payee: E.landlord, amount: BILL_OLD, expiresAt: E.now() - 60e3 });
const guardState = async () => JSON.stringify({ bills: E.store.bills(), allowance: String(E.store.allowance()) });
for (const [id, name, method, path, body] of [
  ['C6a', 'phone creates a bill', 'POST', '/api/home/bills', { id: 'evil', label: 'x', payee: 'evil.near', amountUsdc: 1, expiresAt: '2030-01-01T00:00:00Z' }],
  ['C6b', 'phone edits a bill amount', 'PUT', '/api/home/bills/atk-rent', { label: 'x', payee: 'evil.near', amountUsdc: 99, expiresAt: '2030-01-01T00:00:00Z' }],
  ['C6c', 'phone raises the refill allowance', 'POST', '/api/home/allowance', { totalUsdc: 9999 }],
]) {
  await runCase(id, name, async () => {
    const before = await guardState();
    const r = await E.fetchJ(E.pub, path, { method, headers: E.pocketAuth ? { Authorization: `Bearer ${E.pocketAuth.key}` } : {}, body });
    const alt = await E.fetchJ(E.pub, path.replace('/api/home/', '/api/phone/'), { method, body });
    const after = await guardState();
    const ok = r.status === 404 && alt.status === 404 && before === after;
    const msg = typeof r.body === 'string' ? (r.body.match(/<pre>(.*?)<\/pre>/)?.[1] ?? r.body.slice(0, 60)) : raw({ body: r.body });
    return (ok ? PASS : FAIL)(`HTTP ${r.status} "${msg}" (route does not exist; also /api/phone/…: ${alt.status}) | guard state unchanged: ${before === after}`);
  });
}
await runCase('C6d', 'a home route from a non-loopback address', async () => {
  if (LIVE) return SKIP('mock only (needs a spoofed socket); the check is the same code path');
  const app = createHomeApp(E.svc);
  const sock = new net.Socket(); Object.defineProperty(sock, 'remoteAddress', { value: '10.1.2.3' });
  const req = new http.IncomingMessage(sock);
  Object.assign(req, { method: 'POST', url: '/api/home/allowance', headers: { 'content-type': 'application/json' } });
  req.push(JSON.stringify({ totalUsdc: 9999 })); req.push(null);
  const res = new http.ServerResponse(req); const chunks = [];
  const done = new Promise((r) => { res.write = (c) => { chunks.push(c); return true; }; res.end = (c) => { if (c) chunks.push(c); r(); return res; }; });
  app.handle(req, res); await done;
  return (res.statusCode === 403 && E.store.allowance() === 5_000n ? PASS : FAIL)(`HTTP ${res.statusCode} ${chunks.join('')}`);
});
await runCase('C5', 'phone triggers a bill with an amount and payee in the body', async () => {
  const before = await reqIds(E);
  const r = await E.fetchJ(E.pub, '/api/phone/bills/atk-rent/pay', { method: 'POST', body: { amountUsdc: 1, payee: 'evil.near' } });
  const after = await reqIds(E);
  return (r.status === 400 && added(before, after) === 0 ? PASS : FAIL)(`HTTP ${r.status} ${raw({ body: r.body })} | requests created: ${added(before, after)}`);
});

// ---------------- service side: a leaked reserve key asks, the guard decides
const reserveTransferTo = (e, to, amount) => () => e.ol.reserveTransfer(to, amount);
await runCase('B1', 'refill above the ceiling', async () => {
  const s = await snap(E);
  E.store.raw.prepare("INSERT INTO kv (key,value) VALUES ('phone_ceiling', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(s.pocket + 30_000n));
  E.store.setAllowance(1_000_000n);
  const r = await guardRefusal(E, reserveTransferTo(E, E.pocketAccount, 50_000), 'OVER_CEILING');
  E.store.raw.prepare("DELETE FROM kv WHERE key='phone_ceiling'").run(); E.store.setAllowance(5_000n);
  return r;
});
await runCase('B2', 'refill above the allowance', async () => { E.store.setAllowance(10_000n); const r = await guardRefusal(E, reserveTransferTo(E, E.pocketAccount, 20_000), 'OVER_ALLOWANCE'); E.store.setAllowance(5_000n); return r; });
await runCase('B3a', 'transfer to a whitelisted non-pocket address (landlord)', () => guardRefusal(E, reserveTransferTo(E, E.landlord, 10_000), 'REFILL_NOT_POCKET'));
await runCase('B3b', 'transfer to a whitelisted non-pocket address (owner exit)', () => guardRefusal(E, reserveTransferTo(E, E.exit, 10_000), 'REFILL_NOT_POCKET'));
await runCase('B4', 'transfer and withdraw to a non-whitelisted address', async () => {
  const stranger = crypto.randomBytes(32).toString('hex'); const before = await reqIds(E);
  const a = await E.ol.reserveTransfer(stranger, 10_000), b = await E.ol.reserveWithdraw(stranger, 10_000);
  const after = await reqIds(E);
  const ok = [a, b].every((r) => r.status === 403 && /not in whitelist/.test(JSON.stringify(r.body))) && added(before, after) === 0;
  return (ok ? PASS : FAIL)(`transfer: HTTP ${a.status} ${raw(a).slice(0, 110)} | withdraw: HTTP ${b.status} | requests created: ${added(before, after)}`);
});

// ---------------- bill: tamper cases (guard decides on a real pending approval)
const withdrawTo = (e, to, amount) => () => e.ol.reserveWithdraw(to, amount);
await runCase('C1', 'bill with amount +1 micro-USDC', () => guardRefusal(E, withdrawTo(E, E.landlord, BILL_PAY + 1), 'BILL_AMOUNT_MISMATCH'));
await runCase('C2', 'bill to an altered payee', () => guardRefusal(E, withdrawTo(E, E.exit, BILL_PAY), 'BILL_UNKNOWN_PAYEE'));
await runCase('C3', 'bill after its expiry', () => guardRefusal(E, withdrawTo(E, E.landlord, BILL_OLD), 'BILL_EXPIRED'));

// ---------------- votes (OutLayer's side). A and B are two refill-looking requests to the pocket.
let A, B;
await runCase('D1', 'vote by a fresh key claiming the approver account', async () => {
  A = (await E.ol.reserveTransfer(E.pocketAccount, 10_000)).body; B = (await E.ol.reserveTransfer(E.pocketAccount, 10_000)).body;
  if (!A?.approval_id || !B?.approval_id) return FAIL(`setup failed: ${raw({ body: [A, B] })}`);
  const k = newKey();
  const r = await castVote(E, { account: E.approver.account, pubkey: k.pubkey, seed: k.seed }, B.approval_id);
  const st = await E.ol.request('reserve', B.request_id);
  return (r.status === 401 && st.body?.status === 'pending_approval' ? PASS : FAIL)(`HTTP ${r.status} ${raw(r)} | B still ${st.body?.status}`);
});
await runCase('D2', 'vote by a real full-access key of a non-approver account', async () => {
  const sc = LIVE ? spikeCreds() : (() => { const k = newKey(); return k; })();
  if (!sc) return SKIP('SPIKE6 signer credentials not found in ../carry-spike/.env');
  const r = await castVote(E, { account: sc.account, pubkey: sc.pubkey, seed: sc.seed }, B.approval_id);
  const st = await E.ol.request('reserve', B.request_id);
  return (r.status === 403 && /not_approver/.test(JSON.stringify(r.body)) && st.body?.status === 'pending_approval' ? PASS : FAIL)(`HTTP ${r.status} ${raw(r)} | B still ${st.body?.status}`);
});
await runCase('D3', 'replay a valid vote for approval A onto approval B', async () => {
  const dA = (await E.ol.transport(null, 'GET', `/wallet/v1/approval/${A.approval_id}`)).body;
  const nonce = crypto.randomBytes(32);
  const sigA = signNep413({ seedHex: E.approver.seed, message: `approve:${A.approval_id}:${dA.wallet_pubkey}:${dA.request_hash}`, recipient: 'outlayer.near', nonce });
  const replay = await E.ol.transport(null, 'POST', `/wallet/v1/approve/${B.approval_id}`, { signature: sigA.toString('base64'), public_key: E.approver.pubkey, account_id: E.approver.account, nonce: nonce.toString('base64') });
  const stB = await E.ol.request('reserve', B.request_id);
  const before = await snap(E);
  if (LIVE) spend(10_000, 'D3: approval A legitimately executes (reserve -> pocket)');
  const legit = await E.ol.vote(A.approval_id, A.request_hash); // the real approver, for A only
  const settled = await (await import('../server/outlayer.js')).settle(E.ol, 'reserve', A.request_id, { timeoutMs: LIVE ? 120000 : 5000, intervalMs: LIVE ? 2000 : 20 });
  const after = await snap(E);
  const ok = replay.status === 401 && stB.body?.status === 'pending_approval' && legit.status === 200 && settled.status === 'success' && after.pocket === before.pocket + 10_000n;
  return (ok ? PASS : FAIL)(`replay on B: HTTP ${replay.status} ${raw(replay).slice(0, 90)}; B ${stB.body?.status} | legit vote on A: HTTP ${legit.status}, A ${settled.status}, pocket +${after.pocket - before.pocket}`);
});
await runCase('D4', 'second vote on an already-approved approval', async () => {
  const r = await castVote(E, E.approver, A.approval_id);
  return (r.status === 409 ? PASS : FAIL)(`HTTP ${r.status} ${raw(r)}`);
});
await runCase('D6', 'leaked reserve key alone: a pocket refill with no approver vote', async () => {
  const before = await snap(E); await sleep(LIVE ? 15000 : WAIT);
  const st = await E.ol.request('reserve', B.request_id); const after = await snap(E);
  const cleaned = await rejectIt(E, B.approval_id);
  return (st.body?.status === 'pending_approval' && same(before, after) ? PASS : FAIL)(`B (requested earlier) still ${st.body?.status} after waiting; ${fmt(before)} -> ${fmt(after)} | cleanup: reject -> ${cleaned}`);
});

// ---------------- C7 + C4: one bill, two simultaneous phone triggers, then a third
await runCase('C7', 'two simultaneous phone triggers of the same bill: exactly one payment request', async () => {
  const before = await reqIds(E); const s0 = await snap(E);
  if (LIVE) spend(BILL_PAY, 'C7/C4: the single legitimate bill payment to our own landlord wallet');
  const [x, y] = await Promise.all([1, 2].map(() => E.fetchJ(E.pub, '/api/phone/bills/atk-rent/pay', { method: 'POST', body: {} })));
  const after = await reqIds(E); const s1 = await snap(E);
  const codes = [x.status, y.status].sort(); const refused = [x, y].find((r) => r.status !== 200);
  const used = E.store.bills().find((b) => b.id === 'atk-rent').used;
  const ok = codes[0] === 200 && codes[1] === 422 && refused.body?.code === 'BILL_USED' && added(before, after) === 1 && used && s0.reserve - s1.reserve === BigInt(BILL_PAY);
  return (ok ? PASS : FAIL)(`responses ${x.status}/${y.status}; refused one: ${raw({ body: refused?.body })} | payment requests created: ${added(before, after)} | bill used once: ${used} | reserve ${s0.reserve} -> ${s1.reserve}`);
});
await runCase('C4', 'second use of the bill, later', async () => {
  const s0 = await snap(E); const before = await reqIds(E);
  const r = await E.fetchJ(E.pub, '/api/phone/bills/atk-rent/pay', { method: 'POST', body: {} });
  const s1 = await snap(E); const after = await reqIds(E);
  return (r.status === 422 && r.body?.code === 'BILL_USED' && s0.reserve === s1.reserve && added(before, after) === 0 ? PASS : FAIL)(`HTTP ${r.status} ${raw({ body: r.body })} | reserve ${s0.reserve} -> ${s1.reserve}; requests created ${added(before, after)}`);
});

// ---------------- D5: vote on an expired approval. If OutLayer ACCEPTS it, stop and report; never retry.
let finding = false;
await runCase('D5', 'vote on an EXPIRED approval', async () => {
  if (!LIVE) {
    const r0 = (await E.ol.reserveTransfer(E.pocketAccount, 10_000)).body; E.skew(25 * 3600e3);
    const r = await castVote(E, E.approver, r0.approval_id); const st = await E.ol.request('reserve', r0.request_id); E.resetSkew();
    return (r.status === 409 && /expired/.test(JSON.stringify(r.body)) && st.body?.status === 'pending_approval' ? PASS : FAIL)(`HTTP ${r.status} ${raw(r)} | request ${st.body?.status}`);
  }
  const sc = spikeCreds(); if (!sc) return SKIP('SPIKE6 signer credentials not found');
  const id = 'ae63e6f3-814c-43ff-a8de-aa4eb18b9a7a'; // SPIKE6, created 9 Nov 22:26Z, expires_at 10 Nov 22:26Z
  const detail = await E.ol.transport(null, 'GET', `/wallet/v1/approval/${id}`);
  const d = detail.body; const d0 = `detail: HTTP ${detail.status} status=${d?.status} expires_at=${d?.expires_at}`;
  if (!d?.expires_at || Date.parse(d.expires_at) > Date.now()) return SKIP(`approval is not expired any more or unreadable (${d0})`);
  const r = await castVote(E, { account: sc.account, pubkey: sc.pubkey, seed: sc.seed }, id); // ONE attempt
  if (r.status === 200) {
    finding = true;
    await sleep(3000); // one read (not a retry) of what happened to the request
    let outcome = 'request status not read';
    try { const k = fs.readFileSync('../carry-spike/.env', 'utf8').match(/^SPIKE6_KEY=(.*)$/m)?.[1]; if (k) { const q = await E.ol.transport({ key: k }, 'GET', `/wallet/v1/requests/${d.request_id ?? '98f62dd1-bac8-47f0-9e10-fa90f6e068f1'}`); outcome = `request after the vote: ${q.body?.status} ${JSON.stringify(q.body?.result ?? {})}`; } } catch { /* leave as is */ }
    return { status: 'FINDING', detail: `OutLayer's vote endpoint ACCEPTED a vote on an approval that expired at ${d.expires_at}. ${d0}. Request: POST /wallet/v1/approve/${id} {signature, public_key, account_id (SPIKE6 signer), nonce}. Response: HTTP ${r.status} ${raw(r)}. ${outcome}. Stopping; not retrying.` };
  }
  return ([409, 410, 401, 403].includes(r.status) ? PASS : FAIL)(`${d0} | vote: HTTP ${r.status} ${raw(r)}`);
});
if (finding) { say('STOP: finding recorded above. No further live cases will run.'); finish(); }

// ---------------- B5 B6 B7 B8 each get a fresh service so earlier cases cannot interfere
async function withFresh(opts, fn) { const e = await buildEnv(opts); if (!LIVE) { e.mock.credit(30_000_000); } try { return await fn(e); } finally { e.close(); } }
const payMock = async (e, usdc) => { const q = await e.fetchJ(e.pub, `/api/pay/${e.config.handle}/quote`, { method: 'POST', body: { amountUsdc: usdc, refundTo: REFUND } }); e.mock.simulateDeposit(q.body.address); return q.body; };

if (!LIVE) {
  await runCase('B5', 'refill while the engine is halted (GUARD_SHAPE_CHANGED from a changed approval shape)', () => withFresh({ mockOpts: { tweakApproval: (a) => { a.op.new_field = 'surprise'; return a; } } }, async (e) => {
    e.store.setAllowance(40_000_000n); suppressTimer(e);
    await payMock(e, 5); await ticks(e, 8);
    const halted = e.svc.engine.halted?.code; const ev = e.store.events(50).find((x) => x.kind === 'GUARD_SHAPE_CHANGED');
    const ids1 = await reqIds(e); await payMock(e, 3); await ticks(e, 8); const ids2 = await reqIds(e);
    const votes = [...e.mock.approvals.values()].filter((a) => a.status !== 'pending').length;
    const ok = halted === 'GUARD_SHAPE_CHANGED' && ev && added(ids1, ids2) === 0 && votes === 0 && e.mock.bal.pocket === 0n;
    return (ok ? PASS : FAIL)(`halted=${halted}; event code ${ev?.detail?.code}; second payment created ${added(ids1, ids2)} new requests; votes cast ${votes}; pocket ${e.mock.bal.pocket}`);
  }));
  await runCase('B6', 'refill while the RESERVE is frozen', () => withFresh({}, async (e) => {
    e.store.setAllowance(40_000_000n); suppressTimer(e); e.mock.state.frozenReserve = true;
    await payMock(e, 5); await ticks(e, 8);
    const row = rows(e, 'SELECT state, detail FROM refills WHERE arrival IS NOT NULL')[0]; const det = JSON.parse(row?.detail ?? '{}');
    const ok = row?.state === 'refused' && det.http === 403 && /wallet_frozen/.test(JSON.stringify(det.raw)) && e.store.allowance() === 40_000_000n;
    return (ok ? PASS : FAIL)(`refill ${row?.state}: HTTP ${det.http} ${JSON.stringify(det.raw)} | allowance untouched ${e.store.allowance()}`);
  }));
  await runCase('B7', 'two triggers for one arrival (concurrent ticks, duplicate polls, duplicate arrival insert)', () => withFresh({}, async (e) => {
    e.store.setAllowance(40_000_000n); suppressTimer(e);
    const q = await payMock(e, 5);
    await Promise.all([e.svc.tick(), e.svc.tick(), e.svc.tick(), e.svc.intake.poll(), e.svc.intake.poll()]);
    await ticks(e, 6);
    const dup = e.store.addArrival(q.address, 1, {});
    await Promise.all([e.svc.tick(), e.svc.tick()]);
    const refills = rows(e, 'SELECT state FROM refills WHERE arrival=?', q.address); const reqs = await reqIds(e);
    return (refills.length === 1 && refills[0].state === 'success' && reqs.size === 1 && dup === false ? PASS : FAIL)(`refill rows for the arrival: ${refills.length} (${refills.map((r) => r.state)}); OutLayer requests created: ${reqs.size}; duplicate arrival insert accepted: ${dup}`);
  }));
  await runCase('B8', 'watch while running: allowance 0.03, payment 0.05 arrives later', () => withFresh({}, async (e) => {
    e.store.setAllowance(30_000n); suppressTimer(e);
    const loop = setInterval(() => e.svc.tick(), 100); // the service is already running
    await sleep(500);
    const before = await snap(e); const q = await payMock(e, 0.05);
    await sleep(2500); clearInterval(loop); await ticks(e, 3);
    const s = await snap(e); const refills = rows(e, 'SELECT amount,state FROM refills WHERE arrival=?', q.address);
    const received = 49_990n; // 0.05 USDC less the mock's 0.02% fee
    const ok = refills.length === 1 && refills[0].amount === 30_000 && refills[0].state === 'success' && s.pocket - before.pocket === 30_000n && s.reserve === before.reserve + received - 30_000n && s.allowance === 0n;
    return (ok ? PASS : FAIL)(`refills for the arrival: ${JSON.stringify(refills)}; pocket +${s.pocket - before.pocket}; reserve ${before.reserve} -> ${s.reserve} (kept ${s.reserve - before.reserve}); allowance ${s.allowance}`);
  }));
} else {
  await runCase('B5', 'refill while the engine is halted', async () => {
    E.store.setAllowance(0n); E.svc.engine.halted = { code: 'GUARD_SHAPE_CHANGED', at: Date.now(), approvalId: 'test', detail: {} };
    E.store.addArrival('attack-fake-arrival', 50_000, {}); const before = await reqIds(E);
    await E.svc.engine.cycle(); const after = await reqIds(E);
    const created = rows(E, 'SELECT COUNT(*) c FROM refills WHERE arrival=?', 'attack-fake-arrival')[0].c;
    E.store.raw.prepare("DELETE FROM arrivals WHERE address='attack-fake-arrival'").run(); E.svc.engine.clearHalt();
    return (added(before, after) === 0 && created === 0 ? PASS : FAIL)(`engine halted: cycle created ${added(before, after)} requests and ${created} refill rows for a new arrival (halt flag set in-process; the real trigger is shown in the mock run)`);
  });
  // B7 + B8 together, last (needs the owner's payment)
  if (!ONLY || ONLY.includes('B8') || ONLY.includes('B7')) {
  suppressTimer(E);
  E.store.setAllowance(30_000n);
  const loop = setInterval(() => E.svc.tick(), 3000); // the service is already running
  const reserveBefore = await E.ol.confBalance('reserve'), pocketBefore = await E.ol.confBalance('pocket'); const idsBefore = await reqIds(E);
  const q = await E.svc.intake.quote({ amountUsdc: 0.05, refundTo: REFUND, ip: 'attack' });
  say(`WAITING_FOR_PAYMENT address=${q.address} amount=0.05 USDC network=Solana valid_until=${q.deadline}`);
  spend(50_000, "B8: the owner's payment (stays in the system)"); spend(30_000, 'B8: the refill moved reserve -> pocket');
  const t0 = Date.now(); let arrival = null;
  while (Date.now() - t0 < 20 * 60e3 && !arrival) { await sleep(3000); arrival = E.store.raw.prepare('SELECT * FROM arrivals WHERE address=?').get(q.address); }
  if (!arrival) { clearInterval(loop); await runCase('B8', 'watch while running (live)', async () => FAIL('no payment arrived within 20 minutes')); }
  else {
    await Promise.all([E.svc.tick(), E.svc.tick(), E.svc.tick(), E.svc.intake.poll(), E.svc.intake.poll()]); // B7: simultaneous triggers
    for (let i = 0; i < 40; i++) { const r = rows(E, 'SELECT state FROM refills WHERE arrival=?', q.address)[0]; if (r && ['success', 'failed', 'refused', 'skipped'].includes(r.state)) break; await sleep(3000); }
    clearInterval(loop); await sleep(2000);
    const refills = rows(E, 'SELECT amount,state,request_id FROM refills WHERE arrival=?', q.address);
    const s = await snap(E); const idsAfter = await reqIds(E);
    await runCase('B7', 'two triggers for one arrival (live: concurrent ticks + duplicate polls right after the payment)', async () => {
      const dup = E.store.addArrival(q.address, 1, {});
      return (refills.length === 1 && added(idsBefore, idsAfter) === 1 && dup === false ? PASS : FAIL)(`refill rows for the arrival: ${refills.length}; OutLayer requests created since the payment address was issued: ${added(idsBefore, idsAfter)}; duplicate arrival insert accepted: ${dup}`);
    });
    await runCase('B8', 'watch while running: allowance 0.03, payment 0.05 arrives while the service runs (live)', async () => {
      const received = BigInt(arrival.amount);
      const ok = refills.length === 1 && refills[0].amount === 30_000 && refills[0].state === 'success' && s.pocket - pocketBefore === 30_000n && s.reserve === reserveBefore + received - 30_000n && s.allowance === 0n;
      return (ok ? PASS : FAIL)(`payment received ${received}; refills for the arrival: ${JSON.stringify(refills.map((r) => ({ amount: r.amount, state: r.state, request_id: r.request_id })))}; pocket +${s.pocket - pocketBefore}; reserve ${reserveBefore} -> ${s.reserve} (kept ${s.reserve - reserveBefore}); allowance ${s.allowance}`);
    });
  }
  }
}
await runCase('F1', 'swap and unshield by the pocket key are allowed inside the caps (griefing, not theft)', async () => INFO('documented limit, not a pass: T7 in SPIKE.md. A thief cannot withdraw swapped or unshielded funds but can make them unrecoverable, bounded by the pocket caps.'));
finish();

function finish() {
  const n = (s) => results.filter((r) => r.status === s).length;
  say(`\n# SUMMARY (${LIVE ? 'live' : 'mock'}): ${n('PASS')} PASS, ${n('FAIL')} FAIL, ${n('SKIP')} SKIP, ${n('INFO')} INFO${n('FINDING') ? `, ${n('FINDING')} FINDING` : ''}${LIVE ? ` | live spend counter ${spent / 1e6} USDC (cap ${SPEND_CAP / 1e6})` : ''}`);
  if (!LIVE) say('# MOCK run: this proves the code paths and refusal logic, not mainnet. Run `npm run attack -- --live --yes` for mainnet.');
  fs.mkdirSync('evidence', { recursive: true });
  fs.writeFileSync(`evidence/attack-${LIVE ? 'live' : 'mock'}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`, out.join('\n').replace(/(wk_[A-Za-z0-9]+|Bearer\s+[^\s"]+)/g, '[REDACTED]') + '\n');
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}
