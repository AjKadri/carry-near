import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Amounts are integers in micro-USDC (6 decimals) to avoid float errors.
export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL,          -- payment_in | refill | refused | ...
      amount INTEGER,              -- micro-USDC, nullable
      ok INTEGER NOT NULL DEFAULT 1,
      detail TEXT NOT NULL DEFAULT '{}'  -- JSON, includes raw refusal text when refused
    );
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const getKv = db.prepare('SELECT value FROM kv WHERE key = ?');
  const setKv = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const insertEvent = db.prepare('INSERT INTO events (ts, kind, amount, ok, detail) VALUES (?, ?, ?, ?, ?)');
  const listEvents = db.prepare('SELECT id, ts, kind, amount, ok, detail FROM events ORDER BY id DESC LIMIT ?');
  return {
    raw: db,
    getInt: (key, dflt = 0) => { const r = getKv.get(key); return r ? Number(r.value) : dflt; },
    setInt: (key, n) => { setKv.run(key, String(n)); },
    log: (kind, amount = null, detail = {}, ok = true) =>
      insertEvent.run(new Date().toISOString(), kind, amount, ok ? 1 : 0, JSON.stringify(detail)),
    events: (limit = 100) => listEvents.all(limit).map((e) => ({ ...e, ok: !!e.ok, detail: JSON.parse(e.detail) })),
    close: () => db.close(),
  };
}
