import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { scrub } from './outlayer.js';
import { USDC_TOKEN } from './guard.js';

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ACCOUNT = /^([a-z0-9._-]{2,64}|[0-9a-f]{64})$/;
const usdcToMicro = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? Math.round(n * 1e6) : null; };
export const isLoopback = (a) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(a);

function spa(app) { // built web app, if `npm run build` has run
  const dist = path.resolve('web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
}
const bearer = (req) => { const m = /^Bearer (.+)$/.exec(req.get('authorization') ?? ''); return m ? m[1] : null; };

// HOME app: everything that can steer the approver (bills, allowance) plus the full log and the reserve.
// Loopback only: refused per request even if someone binds it to another interface.
export function createHomeApp(svc) {
  const { store, engine, ol, config } = svc;
  const app = express();
  app.use(express.json());
  app.use('/api/home', (req, res, next) => {
    if (!isLoopback(req.socket.remoteAddress) && process.env.CARRY_HOME_ALLOW_REMOTE !== '1') return res.status(403).json({ error: 'home_only', message: 'home routes accept loopback connections only' });
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/mode', (_req, res) => res.json({ mode: config.mode, publicPort: config.publicPort, homePort: config.homePort, handle: config.handle }));

  app.get('/api/home/state', async (_req, res) => {
    try {
      const [reserve, pocket] = await Promise.all([ol.confBalance('reserve'), ol.confBalance('pocket')]);
      res.json({ reserve: Number(reserve), pocket: Number(pocket), ceiling: Number(store.ceiling()), allowance: Number(store.allowance()), openAddresses: store.countOpenAddresses(), halted: engine.halted && { code: engine.halted.code, at: engine.halted.at }, lastCycle: engine.lastCycle, wallets: svc.walletState, bills: store.bills() });
    } catch (err) { res.status(502).json({ error: 'upstream', message: err.message }); }
  });
  app.get('/api/home/log', (_req, res) => res.json({ events: store.events(200) }));

  app.post('/api/home/allowance', (req, res) => { // HOME ONLY: raises or sets the total refills the approver may approve
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
  app.post('/api/home/bills', (req, res) => {
    const b = billFrom(req.body); if (!b) return res.status(400).json({ error: 'id (slug), label, payee, amountUsdc and expiresAt (ISO) are required' });
    try { store.createBill(b); } catch { return res.status(409).json({ error: 'a bill with that id exists' }); }
    store.log('bill_created', b.amount, { id: b.id, payee: b.payee, expiresAt: new Date(b.expiresAt).toISOString() });
    res.json({ ok: true });
  });
  app.put('/api/home/bills/:id', (req, res) => {
    const b = billFrom({ ...req.body, id: req.params.id }); if (!b) return res.status(400).json({ error: 'invalid bill' });
    const r = store.updateBill(b.id, b);
    if (!r.changes) return res.status(404).json({ error: 'no such unused bill' });
    store.log('bill_edited', b.amount, { id: b.id, payee: b.payee }); res.json({ ok: true });
  });
  app.delete('/api/home/bills/:id', (req, res) => { const r = store.deleteBill(req.params.id); store.log('bill_deleted', null, { id: req.params.id }); res.json({ ok: !!r.changes }); });
  app.post('/api/home/engine/clear-halt', (_req, res) => { engine.clearHalt(); store.log('halt_cleared', null, {}); res.json({ ok: true }); });
  app.post('/api/home/tick', async (_req, res) => { await svc.tick(); res.json({ ok: true, lastCycle: engine.lastCycle }); });
  spa(app);
  return app;
}

// PUBLIC app: the pay page and what the phone may do. There is NO route here that creates or edits a bill,
// raises the allowance, or reads the reserve. test/routes.test.js proves it.
export function createPublicApp(svc) {
  const { store, engine, ol, intake, config } = svc;
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/mode', (_req, res) => res.json({ mode: config.mode, publicPort: config.publicPort, homePort: config.homePort, handle: config.handle }));

  // ---- pay link
  const handleOk = (req, res) => (req.params.handle === intake.handle ? true : (res.status(404).json({ error: 'unknown payment link' }), false));
  app.get('/api/pay/:handle', (req, res) => { if (handleOk(req, res)) res.json(intake.info()); });
  app.post('/api/pay/:handle/quote', async (req, res) => {
    if (!handleOk(req, res)) return;
    try { res.json(await intake.quote({ amountUsdc: req.body?.amountUsdc, refundTo: req.body?.refundTo, ip: req.ip })); }
    catch (err) { res.status(err.status && err.status < 600 ? (err.status === 401 || err.status === 403 ? 502 : err.status) : 502).json({ error: err.message }); }
  });
  app.get('/api/pay/:handle/status', (req, res) => { if (!handleOk(req, res)) return; const s = intake.status(String(req.query.address ?? '')); s ? res.json(s) : res.status(404).json({ error: 'unknown address' }); });
  if (config.mode === 'mock') app.post('/api/mock/pay', (req, res) => { // pretend the payer sent the money
    const ok = svc.mock.simulateDeposit(String(req.body?.address ?? '')); res.status(ok ? 200 : 404).json({ ok });
  });

  // ---- phone: the pocket key arrives in the Authorization header and is never stored or logged
  const unauthorized = (res) => res.status(401).json({ error: 'unauthorized' }); // same body for a missing and a wrong key, no upstream detail
  const needKey = (req, res) => { const k = bearer(req); if (!k) { unauthorized(res); return null; } return { key: k }; };
  app.get('/api/phone/state', async (req, res) => {
    const auth = needKey(req, res); if (!auth) return;
    try { res.json({ pocket: Number(await ol.confBalance(auth)), ceiling: Number(store.ceiling()), note: 'Protected by Carry' }); }
    catch (err) { if (err.status === 401 || err.status === 403) return unauthorized(res); res.status(502).json({ error: 'upstream' }); }
  });
  app.post('/api/phone/send', async (req, res) => {
    const auth = needKey(req, res); if (!auth) return;
    const to = req.body?.to, micro = usdcToMicro(req.body?.amountUsdc);
    if (typeof to !== 'string' || !to || micro === null) return res.status(400).json({ error: 'to and amountUsdc are required' });
    const r = await ol.transport(auth, 'POST', '/wallet/v1/confidential/withdraw', { to, token: USDC_TOKEN, amount: String(micro), chain: 'near' });
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
  spa(app);
  return app;
}
