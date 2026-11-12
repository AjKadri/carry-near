import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { boot } from './helpers.js';
import { MOCK_POCKET_KEY, MOCK_LANDLORD } from '../server/mock.js';

// The phone must never show a reserve amount: not in text, not in the DOM, not in any API response the phone view loads.
const RESERVE = 7_654_321; // a distinctive reserve balance (7.654321 USDC) that cannot be confused with other numbers
const forms = (micro) => [String(micro), (micro / 1e6).toFixed(2), (micro / 1e6).toFixed(6), (micro / 1e6).toFixed(3), (micro / 1e6).toString(), String(Math.round(micro / 1e4) / 100)];
const leaks = (text, micro) => forms(micro).filter((f) => text.includes(f));

async function loadPhoneModules() {
  const out = path.resolve('node_modules/.cache/carry-test');
  fs.mkdirSync(out, { recursive: true });
  const outfile = path.join(out, `phone-${process.pid}.mjs`);
  await build({ entryPoints: ['web/src/phone.jsx'], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const parts = path.join(out, `parts-${process.pid}.mjs`);
  await build({ entryPoints: ['web/src/parts.jsx'], outfile: parts, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  return { phone: await import(outfile), parts: await import(parts), cleanup: () => { fs.rmSync(outfile, { force: true }); fs.rmSync(parts, { force: true }); } };
}

test('phone: no reserve amount in any API response the phone view loads, including refusals', async () => {
  const t = await boot({ allowance: 40_000_000 });
  try {
    t.svc.mock.credit(RESERVE);
    const home = await t.hj('/api/home/state');
    assert.equal(home.body.reserve, RESERVE, 'control: home does see the reserve');
    assert.ok(JSON.stringify(home.body).includes(String(RESERVE)));
    t.svc.store.createBill({ id: 'rent', label: 'Rent', payee: MOCK_LANDLORD, amount: 15_000_000, expiresAt: Date.now() + 3600e3 });
    const auth = { Authorization: `Bearer ${MOCK_POCKET_KEY}` };
    const loaded = [
      await t.j(t.pub, '/api/mode'),
      await t.j(t.pub, '/api/phone/state', { headers: auth }),
      await t.j(t.pub, '/api/phone/bills'),
      await t.j(t.pub, '/api/phone/send', { method: 'POST', headers: auth, body: { to: 'someone.near', amountUsdc: 500 } }), // refused: over the pocket
      await t.j(t.pub, '/api/phone/send', { method: 'POST', headers: auth, body: { to: 'someone.near', amountUsdc: 0.01 } }),
      await t.j(t.pub, '/api/phone/bills/rent/pay', { method: 'POST', body: {} }),
      await t.j(t.pub, '/api/phone/bills/rent/pay', { method: 'POST', body: {} }), // second use: refused
      await t.j(t.pub, '/api/phone/bills/nope/pay', { method: 'POST', body: {} }),
      await t.j(t.pub, '/api/phone/state'), // no key: bare 401
    ];
    for (const r of loaded) {
      const text = JSON.stringify(r.body);
      assert.deepEqual(leaks(text, RESERVE), [], `reserve amount leaked in ${text}`);
    }
    for (const r of loaded.slice(1, 3)) assert.ok(!/reserve/i.test(JSON.stringify(Object.keys(r.body))), 'no reserve key in phone state or bills');
    // the page and its scripts are public too: they must not embed a reserve amount
    for (const p of ['/phone', '/home']) assert.deepEqual(leaks(await (await fetch(t.pub + p)).text(), RESERVE), []);
  } finally { t.close(); }
});

test('phone: the rendered phone view has no reserve amount, and the Protected band has no digits, in every state', async () => {
  const t = await boot({ allowance: 40_000_000 });
  const m = await loadPhoneModules();
  try {
    t.svc.mock.credit(RESERVE);
    const auth = { Authorization: `Bearer ${MOCK_POCKET_KEY}` };
    t.svc.store.createBill({ id: 'rent', label: 'Rent', payee: MOCK_LANDLORD, amount: 15_000_000, expiresAt: Date.now() + 3600e3 });
    const state = (await t.j(t.pub, '/api/phone/state', { headers: auth })).body;
    const bills = (await t.j(t.pub, '/api/phone/bills')).body.bills;
    const refused = await t.j(t.pub, '/api/phone/send', { method: 'POST', headers: auth, body: { to: 'someone.near', amountUsdc: 500 } });
    const base = { status: 'ok', pocket: state.pocket, ceiling: state.ceiling, note: state.note, bills, flipIds: new Set(['rent']), tiles: { filled: 3, from: 1, play: 1 }, to: '', setTo() {}, amt: '1', setAmt() {}, sending: false, onSend() {}, onPay() {} };
    const states = [
      { ...base, split: { share: null, play: 0 }, res: null },
      { ...base, split: { share: 3_000_000, play: 1 }, res: null }, // payday just played
      { ...base, split: { share: null, play: 0 }, res: { ...refused, amount: '500.00', play: 1 } }, // a refusal with its raw reason
      { ...base, status: 'loading', split: { share: null, play: 0 }, res: null },
    ];
    for (const props of states) {
      const html = renderToStaticMarkup(React.createElement(m.phone.PhoneView, props));
      assert.deepEqual(leaks(html, RESERVE), [], 'reserve amount in the phone DOM');
      const bands = [...html.matchAll(/<div class="split-protected"[^>]*>(.*?)<\/div>/g)].map((x) => x[1].replace(/<[^>]+>/g, ''));
      assert.equal(bands.length, 1, 'the Protected band is on the phone');
      assert.equal(bands[0], 'Protected', `band must show only its label, got "${bands[0]}"`);
      assert.ok(!/data-audience="home"/.test(html));
    }
    // defence in depth: even if a caller hands the phone Split a protected amount or a total, it is never drawn
    const html = renderToStaticMarkup(React.createElement(m.parts.Split, { audience: 'phone', incoming: RESERVE + 3_000_000, pocketShare: 3_000_000, protectedAmount: RESERVE }));
    assert.deepEqual(leaks(html, RESERVE), []);
    assert.ok(!html.includes(String((RESERVE + 3_000_000) / 1e6)));
    assert.match(html, /Protected<\/span><\/div>/);
    // control: the home audience does draw the protected amount, so the check above is not vacuous
    assert.ok(renderToStaticMarkup(React.createElement(m.parts.Split, { audience: 'home', incoming: 10e6, pocketShare: 3e6, protectedAmount: 7e6 })).includes('+7.00'));
  } finally { m.cleanup(); t.close(); }
});

test('phone source loads no home routes and imports nothing from the home side', () => {
  const src = ['phone.jsx', 'parts.jsx', 'motion.js'].map((f) => fs.readFileSync(`web/src/${f}`, 'utf8')).join('\n');
  assert.ok(!/api\/home|signedFetch|homeKey|loadKey|createKey/.test(src));
  const api = fs.readFileSync('web/src/api.js', 'utf8'); // the shared fetch helper only reads the server clock from homeKey.js, nothing that signs
  assert.deepEqual([...api.matchAll(/from '\.\/homeKey\.js'/g)].length, 1);
  assert.match(api, /import \{ syncClock \} from '\.\/homeKey\.js'/);
});

test('no literal colours outside web/src/tokens.css', () => {
  const lit = /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color-mix)\(|\b(linear|radial|conic)-gradient\(/;
  for (const f of fs.readdirSync('web/src').filter((n) => n !== 'tokens.css').concat('../index.html')) {
    const text = fs.readFileSync(path.join('web/src', f), 'utf8');
    assert.ok(!lit.test(text), `literal colour in ${f}`);
  }
  const css = (fs.readFileSync('web/src/style.css', 'utf8') + fs.readFileSync('web/src/tokens.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/gradient|box-shadow|text-shadow|drop-shadow|filter: *blur/.test(css), 'no gradients, shadows or glows');
});
