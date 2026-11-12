import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

// The plain sentence above a refusal is derived only from the real refusal (code + numbers in its message).
// Bodies below are copied from real OutLayer refusals recorded in evidence/attack-live-*.txt.
const TOKEN = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
async function load() {
  const out = path.resolve('node_modules/.cache/carry-test'); fs.mkdirSync(out, { recursive: true });
  const f = path.join(out, `refusal-${process.pid}.mjs`);
  await build({ entryPoints: ['web/src/parts.jsx'], outfile: f, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const m = await import(f); fs.rmSync(f, { force: true }); return m.explainRefusal;
}

test('refusal sentence: each real reason, with its real numbers; unknown gets the generic line', async () => {
  const x = await load();
  assert.equal(x(403, { error: 'policy_denied', message: `Per-transaction limit exceeded for ${TOKEN}: 11000000 > 10000000` }), 'Blocked: this phone can send at most 10.00 USDC at a time.');
  assert.equal(x(403, { error: 'policy_denied', message: `Daily limit exceeded for ${TOKEN}: 15000000 + 7000000 > 20000000` }), "Blocked: this would take today's total past the 20.00 USDC daily limit.");
  assert.equal(x(403, { error: 'policy_denied', message: "Address 'abc123' is not in whitelist" }), 'Blocked: that recipient is not on the approved list.');
  assert.equal(x(422, { ok: false, code: 'BILL_USED' }), 'Blocked: this bill has already been paid.');
  assert.match(x(401, { error: 'unauthorized' }), /^Blocked: this device is not recognised/);
  assert.equal(x(403, { error: 'policy_denied', message: "Transaction type 'call' is not allowed by policy" }), 'Blocked by your protection rules.');
  assert.equal(x(500, { weird: true }), 'Blocked by your protection rules.');
  assert.equal(x(422, { error: { error: 'policy_denied', message: `Per-transaction limit exceeded for ${TOKEN}: 30000000 > 20000000` } }), 'Blocked: this phone can send at most 20.00 USDC at a time.'); // wrapped by the home exit route
  assert.equal(x(422, { error: { error: 'policy_denied', message: `Per-transaction limit exceeded for ${TOKEN}: 30000000 > 20000000` } }, 'the reserve'), 'Blocked: the reserve can send at most 20.00 USDC at a time.');
  assert.equal(x(422, { ok: false, code: 'OUTLAYER_REFUSED', http: 403, raw: { error: 'policy_denied', message: "Address 'z' is not in whitelist" } }), 'Blocked: that recipient is not on the approved list.');
});
