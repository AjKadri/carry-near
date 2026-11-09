import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

// Defaults for the mock mode. Caps are set from the home device later (not built yet).
const DEFAULTS = { POCKET_CAP: 50_000_000 }; // 50 USDC in micro-USDC

export function createApp({ config, db }) {
  const app = express();
  app.use(express.json());
  const mock = config.mode === 'mock';

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/mode', (_req, res) => res.json({ mode: config.mode }));

  // PHONE: everything under /api/phone is what the phone may see.
  // It must never return reserve data. test/api.test.js checks this.
  app.get('/api/phone/state', (_req, res) => {
    res.json({
      pocket: db.getInt('pocket_balance'),
      pocketCap: DEFAULTS.POCKET_CAP,
      note: 'Protected by Carry',
    });
  });

  // HOME: reserve balance and full log. No login yet (Roadmap), so the server binds to loopback.
  app.get('/api/home/state', (_req, res) => {
    res.json({
      reserve: db.getInt('reserve_balance'),
      pocket: db.getInt('pocket_balance'),
      pocketCap: DEFAULTS.POCKET_CAP,
    });
  });
  app.get('/api/home/log', (_req, res) => res.json({ events: db.events(100) }));

  // MOCK ONLY: simulate a client paying in. Not present in live mode.
  if (mock) {
    app.post('/api/mock/pay', (req, res) => {
      const usdc = Number(req.body?.amountUsdc);
      if (!Number.isFinite(usdc) || usdc <= 0 || usdc > 1_000_000) {
        return res.status(400).json({ error: 'amountUsdc must be a number between 0 and 1,000,000' });
      }
      const amount = Math.round(usdc * 1e6);
      db.setInt('reserve_balance', db.getInt('reserve_balance') + amount);
      db.log('payment_in', amount, { source: 'mock', chain: 'solana (simulated)' });
      res.json({ ok: true });
    });
  }

  // Built web app, if `npm run build` has run.
  const dist = path.resolve('web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}
