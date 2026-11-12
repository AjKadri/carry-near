import { loadConfig, requireLive } from './config.js';
import { openStore } from './store.js';
import { liveTransport, makeOutLayer } from './outlayer.js';
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
  const svc = {
    config, store, ol, oc, intake, engine, mock, pocketAccount, reserveAccount, auth, pairing,
    get walletState() { return walletState; },
    async start() { walletState = await engine.logWalletState(); store.log('service_start', null, { mode: config.mode, wallets: walletState }); return walletState; },
    // one pass: look for payments, then move money. Never throws.
    async tick() {
      try { await intake.poll(); await engine.cycle(); }
      catch (err) { store.log('tick_error', null, { error: err.message }, false); }
    },
  };
  return svc;
}
