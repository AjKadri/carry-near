// Pay link intake: issue 1Click partner-key deposit addresses (USDC or USDT on a listed source chain -> USDC in the reserve's confidential balance) and track arrivals.
import { issueQuote, dryQuote, getStatus, fetchTokens } from './oneclick.js';
import { listedChains, SAMPLE_REFUND } from './chains.js';

export const MIN_PAY = 50_000;           // 0.05 USDC (1Click quoted 0.05 live on 11 Nov; it refuses 0.01: "Amount is too low for bridge")
export const MAX_PAY = 10_000_000_000;   // 10,000 USDC
const DEADLINE_MS = 72 * 3600e3;
const REISSUE_MARGIN_MS = 12 * 3600e3;   // an address with less than this left is not handed out again
const TOKENS_TTL_MS = 30 * 60e3;         // how long 1Click's /v0/tokens answer is trusted
const DEFAULT_CHAIN = 'sol-usdc';
const usdc = (m) => String(m / 1e6);
const tooLow = (err, chain) => { const m = /try at least (\d+)/i.exec(err?.body?.message ?? ''); return m ? Object.assign(new Error(`The minimum for ${chain.label} is ${usdc(Number(m[1]))} ${chain.symbol}. Enter at least that.`), { status: 400, minimum: Number(m[1]) }) : null; };

export function makeIntake({ store, oc, reserveAccount, handle, payeeName = handle, now = Date.now, maxOpen = 50 }) {
  const hits = new Map(), estHits = new Map(); // ip -> [timestamps]; rate limits for quotes and for dry estimates
  let cache = { at: 0, chains: null };
  // The chains 1Click lists right now. A failed refresh keeps the last good list and retries in a minute.
  const listed = async () => {
    if (cache.chains && now() - cache.at < TOKENS_TTL_MS) return cache.chains;
    try { cache = { at: now(), chains: listedChains(await fetchTokens(oc)) }; }
    catch (e) { if (!cache.chains) throw Object.assign(new Error('could not read the list of supported chains, try again shortly'), { status: 503 }); cache.at = now() - TOKENS_TTL_MS + 60e3; }
    return cache.chains;
  };
  const pick = async (id = DEFAULT_CHAIN) => {
    const chain = (await listed()).find((c) => c.id === id);
    if (!chain) throw Object.assign(new Error('that source is not available on this payment link'), { status: 400 });
    return chain;
  };
  // The lowest amount 1Click accepts from a chain: probe once with the smallest amount we allow; "try at least N" names the floor.
  const mins = new Map();
  const chainMinimum = async (chain) => {
    const hit = mins.get(chain.id);
    if (hit && now() - hit.at < TOKENS_TTL_MS) return hit.minimum;
    let minimum = null;
    try { await dryQuote(oc, { chain, reserveAccount, amountIn: MIN_PAY, refundTo: SAMPLE_REFUND[chain.id], deadlineMs: now() + DEADLINE_MS }); minimum = MIN_PAY; }
    catch (e) { minimum = tooLow(e, chain)?.minimum ?? null; }
    if (minimum != null) mins.set(chain.id, { at: now(), minimum });
    return minimum;
  };
  const checkAmount = (amountUsdc) => {
    const amountIn = Math.round(Number(amountUsdc) * 1e6);
    if (!Number.isFinite(amountIn) || amountIn < MIN_PAY || amountIn > MAX_PAY) throw Object.assign(new Error(`amount must be between ${MIN_PAY / 1e6} and ${MAX_PAY / 1e6} USDC`), { status: 400 });
    return amountIn;
  };
  const limited = (ip, map, max) => {
    const t = now(), recent = (map.get(ip) ?? []).filter((x) => t - x < 10 * 60e3);
    if (recent.length >= max) throw Object.assign(new Error('too many requests, try again in a few minutes'), { status: 429 });
    recent.push(t); map.set(ip, recent);
  };
  const intake = {
    handle,
    async info() {
      const chains = (await listed().catch(() => [])).map((c) => ({ id: c.id, label: c.label, chain: c.chain, symbol: c.symbol, addressName: c.addressName }));
      return { handle, payee: payeeName, asset: 'USDC on Solana', chains, defaultChain: DEFAULT_CHAIN, min: MIN_PAY, max: MAX_PAY };
    },
    // A dry quote: the fee and the lowest accepted amount for one source chain. No address, no money.
    async estimate({ chain: chainId, amountUsdc, ip = 'local' }) {
      const chain = await pick(chainId), amountIn = checkAmount(amountUsdc);
      limited(ip, estHits, 30);
      try {
        const q = await dryQuote(oc, { chain, reserveAccount, amountIn, refundTo: SAMPLE_REFUND[chain.id], deadlineMs: now() + DEADLINE_MS });
        return { chain: chain.id, label: chain.label, amountIn: q.amountIn, amountOut: q.amountOut, fee: Math.max(0, q.amountIn - q.amountOut), minimum: await chainMinimum(chain) };
      } catch (e) {
        const low = tooLow(e, chain);
        if (low) { mins.set(chain.id, { at: now(), minimum: low.minimum }); return { chain: chain.id, label: chain.label, tooLow: true, minimum: low.minimum, error: low.message }; }
        throw e;
      }
    },
    async quote({ chain: chainId, amountUsdc, refundTo, ip = 'local' }) {
      const chain = await pick(chainId), amountIn = checkAmount(amountUsdc);
      const bad = chain.validate(refundTo);
      if (bad) throw Object.assign(new Error(`${bad} Enter your own ${chain.addressName}; it is used only if the payment has to be returned.`), { status: 400 });
      const t = now();
      const reuse = store.reusableAddress(handle, amountIn, refundTo, new Date(t + REISSUE_MARGIN_MS).toISOString(), chain.id);
      if (reuse) return view(reuse);
      limited(ip, hits, 10);
      if (store.countOpenAddresses() >= maxOpen) throw Object.assign(new Error('too many open payment addresses right now, try again later'), { status: 503 });
      let q;
      try { q = await issueQuote(oc, { chain, reserveAccount, amountIn, refundTo, deadlineMs: t + DEADLINE_MS }); }
      catch (e) { throw tooLow(e, chain) ?? e; }
      store.addAddress({ address: q.address, handle, amountIn: q.amountIn, amountOut: q.amountOut, refundTo, deadline: q.deadline, chain: chain.id, minIn: mins.get(chain.id)?.minimum ?? null });
      store.log('address_issued', q.amountIn, { address: q.address, deadline: q.deadline, chain: chain.id });
      return view(store.address(q.address));
    },
    status(address) {
      const a = store.address(address);
      if (!a || a.handle !== handle) return null;
      return { address, status: a.status, amountIn: a.amount_in, deadline: a.deadline, chain: a.chain ?? DEFAULT_CHAIN };
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
              store.log('payment_in', amount, { address: a.address, chain: a.chain ?? DEFAULT_CHAIN, amountIn: st.amountIn, originChainTxHashes: st.originChainTxHashes, nearTxHashes: st.nearTxHashes });
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
  const chainOf = (id) => { const c = (cache.chains ?? []).find((x) => x.id === id); return c ? { id: c.id, label: c.label, chain: c.chain, symbol: c.symbol } : { id }; };
  const view = (a) => ({ address: a.address, amountIn: a.amount_in, amountOut: a.amount_out, minimum: a.min_in ?? null, fee: a.amount_out != null ? Math.max(0, a.amount_in - a.amount_out) : null, deadline: a.deadline, status: a.status, chain: chainOf(a.chain ?? DEFAULT_CHAIN) });
  return intake;
}
