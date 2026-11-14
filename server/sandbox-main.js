// `node server/sandbox-main.js`: the public sandbox service (demo.carry.ajkadri.dev). Mock mode only; see server/sandbox.js.
import { assertMockOnly, createSandbox } from './sandbox.js';

try { assertMockOnly(process.env); } catch (e) { console.error(e.message); process.exit(1); }
const sb = createSandbox({
  max: Number(process.env.SANDBOX_MAX || 500),
  idleMs: Number(process.env.SANDBOX_IDLE_MS || 2 * 3600e3),
  perIpPerHour: Number(process.env.SANDBOX_NEW_PER_IP_HOUR || 30),
});
const port = Number(process.env.PORT || 8798), host = process.env.HOST || '127.0.0.1';
sb.handler.listen(port, host, () => console.log(`Carry sandbox (mock mode, one world per visitor) on http://${host}:${port}`));
let busy = false;
setInterval(async () => { if (busy) return; busy = true; try { await sb.tickAll(); } catch (e) { console.error('tick error:', e.message); } finally { busy = false; } }, Number(process.env.CARRY_TICK_MS || 5000));
