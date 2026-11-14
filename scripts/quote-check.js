// `npm run quote-check`: LIVE dry quotes (dry: true, no deposit address, no money) for every source chain 1Click lists.
// Needs ONECLICK_API_KEY and RESERVE_ACCOUNT in .env. Prints a table and writes evidence/quotes-dry-<timestamp>.json
// (the raw 1Click responses plus our request). Probes several amounts per chain to find the lowest amount 1Click accepts.
import fs from 'node:fs';
import { loadConfig } from '../server/config.js';
import { liveOneClick, fetchTokens, quoteRequest } from '../server/oneclick.js';
import { CHAINS, listedChains, SAMPLE_REFUND } from '../server/chains.js';

const c = loadConfig({ CARRY_MODE: 'live' }).live;
const oc = liveOneClick({ apiKey: c.oneClickKey });
const SAMPLE = SAMPLE_REFUND; // public sample wallets, see server/chains.js
const AMOUNTS = [0.05, 0.25, 0.5, 1, 5, 10, 100];
const tokens = await fetchTokens(oc);
const listed = listedChains(tokens).map((x) => x.id);
const out = { at: new Date().toISOString(), listedByOneClick: listed, notListed: CHAINS.filter((x) => !listed.includes(x.id)).map((x) => x.id), results: [] };
console.log('listed:', listed.join(', ') || '(none)', '| not listed:', out.notListed.join(', ') || '(none)');
for (const ch of CHAINS.filter((x) => listed.includes(x.id))) {
  for (const a of AMOUNTS) {
    const req = quoteRequest({ chain: ch, reserveAccount: c.reserveAccount, amountIn: Math.round(a * 1e6), refundTo: SAMPLE[ch.id], deadlineMs: Date.now() + 72 * 3600e3, dry: true });
    const r = await oc('POST', '/v0/quote', req);
    const q = r.body?.quote;
    out.results.push({ chain: ch.id, amountUsdc: a, http: r.status, request: { ...req, recipient: '<reserve account>' }, response: r.status === 200 || r.status === 201 ? { quote: q } : r.body });
    console.log(ch.id.padEnd(10), String(a).padStart(6), r.status, q ? `in ${Number(q.amountIn) / 1e6} min ${Number(q.minAmountIn) / 1e6} out ${Number(q.amountOut) / 1e6} fee ${((Number(q.amountIn) - Number(q.amountOut)) / 1e6).toFixed(6)}` : JSON.stringify(r.body).slice(0, 110));
    await new Promise((x) => setTimeout(x, 400));
  }
}
const f = `evidence/quotes-dry-${out.at.replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(f, JSON.stringify(out, null, 2) + '\n');
console.log('wrote', f);
