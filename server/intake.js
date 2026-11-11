// Pay link intake: issue 1Click partner-key deposit addresses (Solana USDC -> reserve, confidential) and track arrivals.
import { issueQuote, getStatus } from './oneclick.js';

export const MIN_PAY = 50_000;           // 0.05 USDC (1Click quoted 0.05 live on 11 Nov; it refuses 0.01: "Amount is too low for bridge")
export const MAX_PAY = 10_000_000_000;   // 10,000 USDC
const DEADLINE_MS = 72 * 3600e3;
const REISSUE_MARGIN_MS = 12 * 3600e3;   // an address with less than this left is not handed out again
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function makeIntake({ store, oc, reserveAccount, handle, now = Date.now, maxOpen = 50 }) {
  const hits = new Map(); // ip -> [timestamps]; quote rate limit
  const intake = {
    handle,
    info: () => ({ handle, asset: 'USDC on Solana', min: MIN_PAY, max: MAX_PAY }),
    async quote({ amountUsdc, refundTo, ip = 'local' }) {
      const amountIn = Math.round(Number(amountUsdc) * 1e6);
      if (!Number.isFinite(amountIn) || amountIn < MIN_PAY || amountIn > MAX_PAY) throw Object.assign(new Error(`amount must be between ${MIN_PAY / 1e6} and ${MAX_PAY / 1e6} USDC`), { status: 400 });
      if (typeof refundTo !== 'string' || !SOL_ADDR.test(refundTo)) throw Object.assign(new Error('refundTo must be your Solana address (used only if the payment has to be returned)'), { status: 400 });
      const t = now();
      const recent = (hits.get(ip) ?? []).filter((x) => t - x < 10 * 60e3);
      if (recent.length >= 10) throw Object.assign(new Error('too many requests, try again in a few minutes'), { status: 429 });
      const reuse = store.reusableAddress(handle, amountIn, refundTo, new Date(t + REISSUE_MARGIN_MS).toISOString());
      if (reuse) return view(reuse);
      if (store.countOpenAddresses() >= maxOpen) throw Object.assign(new Error('too many open payment addresses right now, try again later'), { status: 503 });
      recent.push(t); hits.set(ip, recent);
      const q = await issueQuote(oc, { reserveAccount, amountIn, refundTo, deadlineMs: t + DEADLINE_MS });
      store.addAddress({ address: q.address, handle, amountIn: q.amountIn, amountOut: q.amountOut, refundTo, deadline: q.deadline });
      store.log('address_issued', q.amountIn, { address: q.address, deadline: q.deadline });
      return view(store.address(q.address));
    },
    status(address) {
      const a = store.address(address);
      if (!a || a.handle !== handle) return null;
      return { address, status: a.status, amountIn: a.amount_in, deadline: a.deadline };
    },
    // Poll 1Click for every open address. Returns the number of NEW arrivals. Safe to call repeatedly.
    async poll() {
      let arrivals = 0;
      for (const a of store.openAddresses()) {
        let st;
        try { st = await getStatus(oc, a.address); } catch (e) { store.log('intake_error', null, { address: a.address, error: e.message }, false); continue; }
        if (st.status === 'UNKNOWN') { // 1Click may not know an address until money arrives
          if (Date.parse(a.deadline) + 3600e3 < now()) store.setAddressStatus(a.address, 'EXPIRED', true);
          continue;
        }
        if (st.status !== a.status) {
          const final = ['SUCCESS', 'REFUNDED', 'FAILED'].includes(st.status);
          store.setAddressStatus(a.address, st.status, final);
          if (st.status === 'SUCCESS') {
            const amount = st.amountOut ?? a.amount_out ?? a.amount_in;
            if (store.addArrival(a.address, amount, { amountIn: st.amountIn, nearTxHashes: st.nearTxHashes, originChainTxHashes: st.originChainTxHashes })) {
              store.log('payment_in', amount, { address: a.address, amountIn: st.amountIn, originChainTxHashes: st.originChainTxHashes, nearTxHashes: st.nearTxHashes });
              arrivals++;
            }
          } else if (['REFUNDED', 'FAILED', 'INCOMPLETE_DEPOSIT'].includes(st.status)) {
            store.log('payment_problem', st.amountIn ?? null, { address: a.address, status: st.status }, false);
          }
        }
      }
      return arrivals;
    },
  };
  const view = (a) => ({ address: a.address, amountIn: a.amount_in, deadline: a.deadline, status: a.status });
  return intake;
}
