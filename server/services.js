import { loadConfig, requireLive } from './config.js';
import { openStore } from './store.js';
import { liveTransport, makeOutLayer, isTransient } from './outlayer.js';
import { liveOneClick } from './oneclick.js';
import { makeIntake } from './intake.js';
import { makeEngine } from './engine.js';
import { createMock, MOCK_POCKET_ACCOUNT, MOCK_RESERVE_ACCOUNT, MOCK_POCKET_KEY } from './mock.js';
import { makeHomeAuth } from './homeauth.js';
import { makePairing } from './pairing.js';

export function createServices(config = loadConfig(), { now = Date.now, mockOpts = {}, settleOpts } = {}) {
  const store = openStore(config.dbPath);
  let transport, oc, approver, pocketAccount, reserveAccount, mock = null;
  if (config.mode === 'mock') {
    mock = createMock({ now, phoneTxLimit: config.phone.perTx, ...mockOpts });
    ({ transport, oneClick: oc, approver } = mock);
    pocketAccount = MOCK_POCKET_ACCOUNT; reserveAccount = MOCK_RESERVE_ACCOUNT;
    if (store.getInt('allowance_remaining', -1) < 0) store.setAllowance(config.demoAllowance); // mock demo only; live starts at 0
  } else {
    requireLive(config);
    const l = config.live;
    transport = liveTransport({ base: l.base, keys: { reserve: l.reserveKey, pocket: l.pocketKey } });
    oc = liveOneClick({ apiKey: l.oneClickKey });
    approver = l.approver; pocketAccount = l.pocketAccount; reserveAccount = l.reserveAccount;
    if (store.getInt('allowance_remaining', -1) < 0) store.setAllowance(0n);
  }
  store.initCeiling(config.phone.ceiling);
  const ol = makeOutLayer(transport, { approver });
  const intake = makeIntake({ store, oc, reserveAccount, handle: config.handle, now });
  const engine = makeEngine({ store, ol, pocketAccount, now, topUpEveryMs: config.topUpEveryMs, settleOpts });
  const auth = makeHomeAuth({ store, now });
  const pocketCredential = () => ({ pocketKey: config.mode === 'mock' ? MOCK_POCKET_KEY : config.live.pocketKey, pocketAccount });
  const pairing = makePairing({ credential: pocketCredential, now, log: (kind, detail) => store.log(kind, null, detail) });
  let walletState = null;
  const warned = new Map(); // soft-warning de-duplication: one entry per call and status per 5 minutes
  const svc = {
    config, store, ol, oc, intake, engine, mock, pocketAccount, reserveAccount, auth, pairing,
    get walletState() { return walletState; },
    async start() { walletState = await engine.logWalletState(); store.log('service_start', null, { mode: config.mode, wallets: walletState }); return walletState; },
    // one pass: look for payments, then move money. Never throws.
    async tick() {
      try { await intake.poll(); await engine.cycle(); }
      catch (err) {
        const detail = { call: err.call ?? null, status: err.status ?? null, attempts: err.attempts ?? 1, error: err.message };
        if (isTransient(err)) { // the platform had a bad moment (5xx / timeout) and the read was retried: a soft warning, not an error. Nothing was changed; the next tick tries again.
          const k = `${detail.call}|${detail.status}`, last = warned.get(k);
          if (!last || now() - last.at > 5 * 60e3) {
            store.log('tick_warning', null, { ...detail, suppressed: last?.n ?? 0, note: 'temporary platform error after retries; nothing was changed; will try again on the next tick' }, true);
            console.warn(`tick warning: ${detail.call ?? 'unknown call'} ${detail.status ?? ''} ${detail.error.slice(0, 120)}`);
            warned.set(k, { at: now(), n: 0 });
          } else last.n++;
        } else store.log('tick_error', null, detail, false);
      }
    },
  };
  return svc;
}
