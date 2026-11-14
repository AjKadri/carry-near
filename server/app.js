import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { scrub } from './outlayer.js';
import { USDC_TOKEN } from './guard.js';
import { MOCK_LANDLORD } from './mock.js';

const SAMPLE_REFUND = '7puyGCiSnh55z3EzWEr8MKDBw9FYH2izq4K4mXPNpcuo'; // a well-formed Solana address for the sandbox's simulated client payments

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ACCOUNT = /^([a-z0-9._-]{2,64}|[0-9a-f]{64})$/;
const usdcToMicro = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? Math.round(n * 1e6) : null; };
const bearer = (req) => { const m = /^Bearer (.+)$/.exec(req.get('authorization') ?? ''); return m ? m[1] : null; };

// ONE app. Three kinds of route:
//   public   pay page, phone API (pocket key in the Authorization header), pairing claim/result
//   signed   everything under /api/home/*: bills, allowance, halt, exit, pairing control, reserve balance, full log.
//            Every request must carry a valid laptop device-key signature (server/homeauth.js); anything else is a bare 401.
//   static   the web app
// There is no way to reach a signed route without the signature: the middleware runs before the route table.
export function createApp(svc, { sandbox = false, noStatic = false } = {}) {
  const { store, engine, ol, intake, config, auth, pairing } = svc;
  const app = express();
  app.set('trust proxy', 'loopback'); // Caddy on the same host; req.ip is then the real client for the blocked log
  app.disable('x-powered-by');
  app.use((_req, res, next) => { // limits what script can run in the page that holds the home key
    res.set({ 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    next();
  });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }); // never reuse an API answer (a cached one carries an old Date header and old data, e.g. after the back button)
  app.use(express.json({ limit: '10kb', verify: (req, _res, buf) => { req.rawBody = buf; } })); // the signature covers the raw bytes
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/mode', (_req, res) => res.json({
    mode: config.mode, handle: config.handle, publicUrl: config.publicUrl,
    sandbox, // a public per-visitor mock world (server/sandbox.js)
    landing: config.mode === 'live' && !sandbox, // the live instance shows a small landing page at "/"
    sample: sandbox ? { landlord: MOCK_LANDLORD, refundTo: SAMPLE_REFUND, rentUsdc: 15 } : undefined, // what the sandbox tour uses
    sandboxUrl: config.sandboxUrl, liveUrl: config.liveUrl, repoUrl: config.repoUrl, videoUrl: config.videoUrl,
  }));

  // ---------------- unsigned: device-key setup (one time, needs the code printed on the server console)
  // Public: is a key registered, what time does the server think it is, and (if the browser sends the fingerprint of its own public key) is that the registered one?
  // The fingerprint is a hash of a public key, so this reveals nothing secret. The browser uses it to tell "this key is not the registered one" from a transient failure.
  app.get('/api/home/auth/status', (req, res) => {
    const fp = /^[0-9a-f]{64}$/.test(String(req.query.key ?? '')) ? String(req.query.key) : null;
    res.json({ registered: auth.registered(), serverTime: auth.now(), matches: fp && auth.registered() ? fp === auth.fingerprint() : null });
  });
  app.post('/api/home/auth/setup', (req, res) => {
    const r = auth.register({ publicKeySpkiB64: req.body?.publicKey, code: req.body?.setupCode });
    res.status(r.ok ? 200 : r.status).json(r.ok ? { ok: true } : { error: r.error });
  });

  // ---------------- public: pay link
  const handleOk = (req, res) => (req.params.handle === intake.handle ? true : (res.status(404).json({ error: 'unknown payment link' }), false));
  app.get('/api/pay/:handle', async (req, res) => { if (handleOk(req, res)) res.json(await intake.info()); });
  const payErr = (res, err) => res.status(err.status && err.status < 600 ? (err.status === 401 || err.status === 403 ? 502 : err.status) : 502).json({ error: err.message });
  app.post('/api/pay/:handle/estimate', async (req, res) => {
    if (!handleOk(req, res)) return;
    try { res.json(await intake.estimate({ chain: req.body?.chain, amountUsdc: req.body?.amountUsdc, ip: req.ip })); } catch (err) { payErr(res, err); }
  });
  app.post('/api/pay/:handle/quote', async (req, res) => {
    if (!handleOk(req, res)) return;
    try { res.json(await intake.quote({ chain: req.body?.chain, amountUsdc: req.body?.amountUsdc, refundTo: req.body?.refundTo, ip: req.ip })); }
    catch (err) { payErr(res, err); }
  });
  app.get('/api/pay/:handle/status', (req, res) => { if (!handleOk(req, res)) return; const s = intake.status(String(req.query.address ?? '')); s ? res.json(s) : res.status(404).json({ error: 'unknown address' }); });
  if (config.mode === 'mock') app.post('/api/mock/pay', (req, res) => { const ok = svc.mock.simulateDeposit(String(req.body?.address ?? '')); res.status(ok ? 200 : 404).json({ ok }); });

  // ---------------- public: phone (the pocket key arrives in the header and is never stored or logged)
  const unauthorized = (res) => res.status(401).json({ error: 'unauthorized' });
  const needKey = (req, res) => { const k = bearer(req); if (!k) { unauthorized(res); return null; } return { key: k }; };
  app.get('/api/phone/state', async (req, res) => {
    const a = needKey(req, res); if (!a) return;
    try { res.json({ pocket: Number(await ol.confBalance(a)), ceiling: Number(store.ceiling()), sendLimit: Number(config.phone.perTx), note: 'Protected by Carry' }); }
    catch (err) { if (err.status === 401 || err.status === 403) return unauthorized(res); res.status(502).json({ error: 'upstream' }); }
  });
  app.post('/api/phone/send', async (req, res) => {
    const a = needKey(req, res); if (!a) return;
    const to = req.body?.to, micro = usdcToMicro(req.body?.amountUsdc);
    if (typeof to !== 'string' || !to || micro === null) return res.status(400).json({ error: 'to and amountUsdc are required' });
    const r = await ol.transport(a, 'POST', '/wallet/v1/confidential/withdraw', { to, token: USDC_TOKEN, amount: String(micro), chain: 'near' });
    if (r.status === 401) return unauthorized(res);
    const ok = r.status === 200;
    store.log(ok ? 'phone_send' : 'phone_send_refused', micro, { to, http: r.status, raw: JSON.parse(scrub(r.body)) }, ok);
    res.status(r.status).json(r.body); // the raw refusal goes back to the phone, on purpose
  });
  app.get('/api/phone/bills', (_req, res) => res.json({ bills: store.bills() })); // read only
  app.post('/api/phone/bills/:id/pay', async (req, res) => { // trigger an EXISTING bill by id; nothing in the body can change it
    if (req.body && Object.keys(req.body).length) { store.log('bill_refused', null, { id: req.params.id, reason: 'body not allowed', fields: Object.keys(req.body) }, false); return res.status(400).json({ error: 'a bill is paid by id only; amount and payee come from the stored bill' }); }
    const r = await engine.payBill(req.params.id);
    res.status(r.ok ? 200 : 422).json(r);
  });

  // ---------------- public: pairing (phone side)
  app.post('/api/pair/claim', (req, res) => { const r = pairing.claim(req.body?.id, req.body?.secret); res.status(r.ok ? 200 : r.status).json(r.ok ? { code: r.code } : { error: 'cannot pair' }); });
  // the secret travels in a header, never in the URL, so it cannot end up in an access log, a proxy log or browser history
  app.get('/api/pair/:id/result', (req, res) => { const r = pairing.result(req.params.id, String(req.get('x-pair-secret') ?? '')); res.status(r.status).json(r.body); });

  // ---------------- signed: HOME. The middleware runs first for EVERY /api/home path not handled above.
  const home = express.Router();
  app.use('/api/home', auth.middleware, home);

  home.get('/state', async (_req, res) => {
    try {
      const [reserve, pocket] = await Promise.all([ol.confBalance('reserve'), ol.confBalance('pocket')]);
      res.json({ reserve: Number(reserve), pocket: Number(pocket), ceiling: Number(store.ceiling()), allowance: Number(store.allowance()), openAddresses: store.countOpenAddresses(), halted: engine.halted && { code: engine.halted.code, at: engine.halted.at }, lastCycle: engine.lastCycle, wallets: svc.walletState, bills: store.bills(), exitAccount: config.exitAccount });
    } catch (err) { res.status(502).json({ error: 'upstream', message: err.message }); }
  });
  home.get('/log', (_req, res) => res.json({ events: store.events(200) }));
  home.post('/allowance', (req, res) => { // raises or sets the total refills the approver may approve
    const { totalUsdc } = req.body ?? {};
    const micro = totalUsdc === 0 ? 0 : usdcToMicro(totalUsdc);
    if (micro === null || micro > 10_000_000_000) return res.status(400).json({ error: 'totalUsdc must be a number from 0 to 10000' });
    const before = Number(store.allowance());
    store.setAllowance(BigInt(micro));
    store.log('allowance_set', micro, { before, after: micro });
    res.json({ ok: true, allowance: micro });
  });
  const billFrom = (b) => {
    const amount = usdcToMicro(b?.amountUsdc), expiresAt = Date.parse(b?.expiresAt);
    if (!SLUG.test(b?.id ?? '') || typeof b?.label !== 'string' || !b.label || !ACCOUNT.test(b?.payee ?? '') || amount === null || !Number.isFinite(expiresAt)) return null;
    return { id: b.id, label: b.label.slice(0, 80), payee: b.payee, amount, expiresAt };
  };
  home.post('/bills', (req, res) => {
    const b = billFrom(req.body); if (!b) return res.status(400).json({ error: 'id (slug), label, payee, amountUsdc and expiresAt (ISO) are required' });
    try { store.createBill(b); } catch { return res.status(409).json({ error: 'a bill with that id exists' }); }
    store.log('bill_created', b.amount, { id: b.id, payee: b.payee, expiresAt: new Date(b.expiresAt).toISOString() });
    res.json({ ok: true });
  });
  home.put('/bills/:id', (req, res) => {
    const b = billFrom({ ...req.body, id: req.params.id }); if (!b) return res.status(400).json({ error: 'invalid bill' });
    if (!store.updateBill(b.id, b).changes) return res.status(404).json({ error: 'no such unused bill' });
    store.log('bill_edited', b.amount, { id: b.id, payee: b.payee }); res.json({ ok: true });
  });
  home.delete('/bills/:id', (req, res) => { const r = store.deleteBill(req.params.id); store.log('bill_deleted', null, { id: req.params.id }); res.json({ ok: !!r.changes }); });
  home.post('/engine/clear-halt', (_req, res) => { engine.clearHalt(); store.log('halt_cleared', null, {}); res.json({ ok: true }); });
  home.post('/tick', async (_req, res) => { await svc.tick(); res.json({ ok: true, lastCycle: engine.lastCycle }); });
  // Withdraw to the owner's exit account. Carry's approver never approves this (the guard refuses it); the owner approves it in the OutLayer dashboard.
  home.post('/exit', async (req, res) => {
    const micro = usdcToMicro(req.body?.amountUsdc);
    if (micro === null) return res.status(400).json({ error: 'amountUsdc is required' });
    const r = await ol.reserveWithdraw(config.exitAccount, micro);
    store.log(r.status === 200 ? 'exit_requested' : 'exit_refused', micro, { to: config.exitAccount, http: r.status, raw: JSON.parse(scrub(r.body)) }, r.status === 200);
    res.status(r.status === 200 ? 200 : 422).json(r.status === 200 ? { requestId: r.body.request_id, approvalId: r.body.approval_id, status: r.body.status, note: 'waiting for the owner to approve in the OutLayer dashboard' } : { error: r.body });
  });
  // pairing control (laptop)
  home.post('/pair/start', (req, res) => { const s = pairing.start(); s ? res.json(s) : res.status(429).json({ error: 'too many open pairing sessions' }); });
  home.get('/pair/:id', (req, res) => res.json(pairing.view(req.params.id)));
  home.post('/pair/:id/confirm', (req, res) => res.json({ ok: pairing.confirm(req.params.id) }));
  home.post('/pair/:id/cancel', (req, res) => { pairing.cancel(req.params.id); res.json({ ok: true }); });

  // ---------------- sandbox only: this visitor's own mock world. Never mounted on the live instance.
  if (sandbox) {
    // Home is set up automatically for this session: the browser still makes its own non-extractable device key and registers it through
    // the normal setup route; only the one-time code is handed out here (it belongs to this visitor's world and nothing else).
    app.get('/api/sandbox/setup-code', (_req, res) => { const code = auth.setupCode(); code ? res.json({ setupCode: code }) : res.status(409).json({ error: 'already set up' }); });
    // The owner's approval of a withdrawal, simulated: approves a pending exit request in this visitor's own mock OutLayer. Nothing else can be approved this way.
    app.post('/api/sandbox/approve-withdrawal', (req, res) => { const ok = !!svc.mock?.adminApprove(String(req.body?.requestId ?? '')); res.status(ok ? 200 : 404).json({ ok }); });
    // One click pairs a phone view for this session, through the normal pairing module (start, claim, confirm, result).
    app.post('/api/sandbox/phone', (_req, res) => {
      const s = pairing.start(); if (!s) return res.status(429).json({ error: 'too many open pairing sessions' });
      pairing.claim(s.id, s.secret); pairing.confirm(s.id);
      const r = pairing.result(s.id, s.secret);
      res.status(r.status).json(r.body);
    });
  }

  // ---------------- static web app
  const dist = path.resolve('web/dist');
  if (!noStatic && fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}
