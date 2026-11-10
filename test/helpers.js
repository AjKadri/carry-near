import { loadConfig } from '../server/config.js';
import { createServices } from '../server/services.js';
import { createHomeApp, createPublicApp } from '../server/app.js';

export const REFUND = '7puyGCiSnh55z3EzWEr8MKDBw9FYH2izq4K4mXPNpcuo';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function boot({ allowance, mockOpts = {}, now } = {}) {
  const config = loadConfig({ CARRY_MODE: 'mock', CARRY_DB: ':memory:' });
  const svc = createServices(config, { now, mockOpts: { settleDelayMs: 30, ...mockOpts }, settleOpts: { intervalMs: 20, timeoutMs: 5000 } });
  if (allowance !== undefined) svc.store.setAllowance(BigInt(allowance));
  await svc.start();
  const servers = [];
  const listen = async (app) => { const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r)); servers.push(s); return `http://127.0.0.1:${s.address().port}`; };
  const home = await listen(createHomeApp(svc)), pub = await listen(createPublicApp(svc));
  const j = async (base, p, init = {}) => { const r = await fetch(base + p, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, body: init.body && typeof init.body !== 'string' ? JSON.stringify(init.body) : init.body }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const pay = async (amountUsdc) => { // a client asks for an address, then "pays" it
    const q = await j(pub, `/api/pay/${config.handle}/quote`, { method: 'POST', body: { amountUsdc, refundTo: REFUND } });
    if (q.status !== 200) throw new Error('quote failed ' + JSON.stringify(q));
    svc.mock.simulateDeposit(q.body.address); return q.body;
  };
  const settleAll = async (n = 12) => { for (let i = 0; i < n; i++) { await svc.tick(); await sleep(60); } };
  const kinds = () => svc.store.events(500).map((e) => e.kind).reverse();
  return { svc, config, home, pub, j, pay, settleAll, kinds, close: () => { servers.forEach((s) => s.close()); svc.store.close(); } };
}
