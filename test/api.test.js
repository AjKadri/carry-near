import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

async function start(mode = 'mock') {
  const db = openDb(':memory:');
  const server = createApp({ config: loadConfig({ CARRY_MODE: mode }), db }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, base, close: () => { server.close(); db.close(); } };
}
const json = (base, p, init) => fetch(base + p, init).then(async (r) => ({ status: r.status, body: await r.json() }));

test('mock payment shows on home, never reserve data on phone', async () => {
  const s = await start();
  try {
    const pay = await json(s.base, '/api/mock/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountUsdc: 12.5 }) });
    assert.equal(pay.status, 200);
    const home = await json(s.base, '/api/home/state');
    assert.equal(home.body.reserve, 12_500_000);
    const log = await json(s.base, '/api/home/log');
    assert.equal(log.body.events[0].kind, 'payment_in');
    const phone = await json(s.base, '/api/phone/state');
    assert.equal('reserve' in phone.body, false);
    assert.equal(JSON.stringify(phone.body).includes('12500000'), false);
  } finally { s.close(); }
});

test('mock pay rejects bad amounts', async () => {
  const s = await start();
  try {
    for (const amountUsdc of [0, -1, 'abc', 1e9]) {
      const r = await json(s.base, '/api/mock/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountUsdc }) });
      assert.equal(r.status, 400);
    }
  } finally { s.close(); }
});

test('mock endpoint absent outside mock mode', async () => {
  const s = await start('live');
  try {
    const r = await fetch(s.base + '/api/mock/pay', { method: 'POST' });
    assert.equal(r.status, 404);
  } finally { s.close(); }
});
