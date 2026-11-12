import test from 'node:test';
import assert from 'node:assert/strict';
import { rows } from '../scripts/contrast.js';

test('every text/background pair in tokens.css meets WCAG AA (4.5:1)', () => {
  const all = rows();
  assert.ok(all.length >= 13);
  for (const r of all) assert.ok(r.ratio >= 4.5, `${r.label}: ${r.fg} on ${r.bg} = ${r.ratio.toFixed(2)}`);
});
