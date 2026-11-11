import { loadConfig } from '../server/config.js';
import { createServices } from '../server/services.js';
import { createApp } from '../server/app.js';
import { makeTestDevice } from '../server/homeauth.js';

export const REFUND = '7puyGCiSnh55z3EzWEr8MKDBw9FYH2izq4K4mXPNpcuo';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function boot({ allowance, mockOpts = {}, now, register = true } = {}) {
  const config = loadConfig({ CARRY_MODE: 'mock', CARRY_DB: ':memory:' });
  const svc = createServices(config, { now, mockOpts: { settleDelayMs: 30, ...mockOpts }, settleOpts: { intervalMs: 20, timeoutMs: 5000 } });
  if (allowance !== undefined) svc.store.setAllowance(BigInt(allowance));
  await svc.start();
  const server = createApp(svc).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const device = makeTestDevice();
  if (register) { const r = svc.auth.register({ publicKeySpkiB64: device.publicKeySpkiB64, code: svc.auth.setupCode() }); if (!r.ok) throw new Error('device setup failed'); }
  const j = async (b, p, init = {}) => { const r = await fetch(b + p, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, body: init.body && typeof init.body !== 'string' ? JSON.stringify(init.body) : init.body }); return { status: r.status, body: await r.json().catch(() => null) }; };
  // a request from the paired laptop: signed exactly like the browser signs it
  const hj = (p, { method = 'GET', body, headers = {}, sign = {} } = {}) => {
    const raw = body === undefined ? '' : JSON.stringify(body);
    return j(base, p, { method, body: raw || undefined, headers: { ...device.sign({ method, path: p, body: raw, time: (now ?? Date.now)(), ...sign }), ...headers } });
  };
  const pay = async (amountUsdc) => {
    const q = await j(base, `/api/pay/${config.handle}/quote`, { method: 'POST', body: { amountUsdc, refundTo: REFUND } });
    if (q.status !== 200) throw new Error('quote failed ' + JSON.stringify(q));
    svc.mock.simulateDeposit(q.body.address); return q.body;
  };
  const settleAll = async (n = 12) => { for (let i = 0; i < n; i++) { await svc.tick(); await sleep(60); } };
  const kinds = () => svc.store.events(500).map((e) => e.kind).reverse();
  return { svc, config, pub: base, home: base, device, j, hj, pay, settleAll, kinds, close: () => { server.close(); svc.store.close(); } };
}
