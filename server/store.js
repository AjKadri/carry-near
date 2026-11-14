// Carry's own state (SQLite). Amounts are integers in micro-USDC. Everything the guard trusts
// (bills, allowance) is written ONLY through functions called from home-only routes or the engine.
import { openDb } from './db.js';

export function openStore(file) {
  const base = openDb(file);
  const db = base.raw;
  db.exec(`
    CREATE TABLE IF NOT EXISTS addresses (
      address TEXT PRIMARY KEY, handle TEXT NOT NULL, amount_in INTEGER NOT NULL, amount_out INTEGER,
      refund_to TEXT NOT NULL, deadline TEXT NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING_DEPOSIT', final INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS arrivals (
      address TEXT PRIMARY KEY, amount INTEGER NOT NULL, detected_at TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS refills (
      id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, arrival TEXT, amount INTEGER NOT NULL,
      state TEXT NOT NULL, request_id TEXT, approval_id TEXT, request_hash TEXT,
      reserved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, payee TEXT NOT NULL, amount INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, used_at TEXT, request_id TEXT);
  `);
  for (const col of ['chain TEXT NOT NULL DEFAULT \'sol-usdc\'', 'min_in INTEGER']) { try { db.exec(`ALTER TABLE addresses ADD COLUMN ${col}`); } catch { /* already there */ } }
  const q = (sql) => db.prepare(sql);
  const now = () => new Date().toISOString();
  const s = {
    ...base,
    // --- settings the guard depends on
    allowance: () => BigInt(base.getInt('allowance_remaining', 0)),
    setAllowance: (n) => base.setInt('allowance_remaining', Number(n)),
    initCeiling: (n) => { if (base.getInt('phone_ceiling', -1) < 0) base.setInt('phone_ceiling', Number(n)); },
    ceiling: () => BigInt(base.getInt('phone_ceiling', 20_000_000)),
    // --- bills
    createBill: (b) => q('INSERT INTO bills (id,label,payee,amount,expires_at) VALUES (?,?,?,?,?)').run(b.id, b.label, b.payee, b.amount, b.expiresAt),
    updateBill: (id, b) => q('UPDATE bills SET label=?, payee=?, amount=?, expires_at=? WHERE id=? AND used=0').run(b.label, b.payee, b.amount, b.expiresAt, id),
    deleteBill: (id) => q('DELETE FROM bills WHERE id=? AND used=0').run(id),
    bills: () => q('SELECT * FROM bills ORDER BY rowid').all().map((r) => ({ id: r.id, label: r.label, payee: r.payee, amount: String(r.amount), expiresAt: r.expires_at, used: !!r.used, usedAt: r.used_at })),
    markBillUsed: (id, requestId) => q('UPDATE bills SET used=1, used_at=?, request_id=? WHERE id=? AND used=0').run(now(), requestId ?? null, id).changes === 1,
    unuseBill: (id) => q('UPDATE bills SET used=0, used_at=NULL WHERE id=?').run(id),
    // --- addresses and arrivals
    addAddress: (a) => q('INSERT INTO addresses (address,handle,amount_in,amount_out,refund_to,deadline,created_at,chain,min_in) VALUES (?,?,?,?,?,?,?,?,?)').run(a.address, a.handle, a.amountIn, a.amountOut ?? null, a.refundTo, a.deadline, now(), a.chain ?? 'sol-usdc', a.minIn ?? null),
    address: (addr) => q('SELECT * FROM addresses WHERE address=?').get(addr),
    reusableAddress: (handle, amountIn, refundTo, notAfter, chain = 'sol-usdc') => q("SELECT * FROM addresses WHERE handle=? AND amount_in=? AND refund_to=? AND chain=? AND final=0 AND status='PENDING_DEPOSIT' AND deadline>? ORDER BY created_at DESC LIMIT 1").get(handle, amountIn, refundTo, chain, notAfter),
    openAddresses: () => q('SELECT * FROM addresses WHERE final=0').all(),
    countOpenAddresses: () => q("SELECT COUNT(*) c FROM addresses WHERE final=0 AND status='PENDING_DEPOSIT'").get().c,
    setAddressStatus: (addr, status, final) => q('UPDATE addresses SET status=?, final=? WHERE address=?').run(status, final ? 1 : 0, addr),
    addArrival: (addr, amount, detail) => q('INSERT OR IGNORE INTO arrivals (address,amount,detected_at,detail) VALUES (?,?,?,?)').run(addr, amount, now(), JSON.stringify(detail ?? {})).changes === 1,
    arrivalsWithoutRefill: () => q('SELECT a.* FROM arrivals a WHERE NOT EXISTS (SELECT 1 FROM refills r WHERE r.arrival = a.address) ORDER BY a.detected_at').all(),
    // --- refills
    refillByKey: (key) => q('SELECT * FROM refills WHERE key=?').get(key),
    createRefill: (r) => q('INSERT INTO refills (key,arrival,amount,state,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(r.key, r.arrival ?? null, r.amount, 'planned', now(), now()),
    refill: (id) => q('SELECT * FROM refills WHERE id=?').get(id),
    activeRefills: () => q("SELECT * FROM refills WHERE state NOT IN ('success','failed','refused','skipped') ORDER BY id").all(),
    updateRefill: (id, f) => {
      const cols = Object.keys(f);
      q(`UPDATE refills SET ${cols.map((c) => `${c}=?`).join(',')}, updated_at=? WHERE id=?`).run(...cols.map((c) => (typeof f[c] === 'object' && f[c] !== null ? JSON.stringify(f[c]) : f[c])), now(), id);
    },
    // Reserve the allowance and the bill IN ONE TRANSACTION before any vote is signed.
    reserveRefill: (id, amount) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const left = BigInt(base.getInt('allowance_remaining', 0));
        if (BigInt(amount) > left) { db.exec('ROLLBACK'); return false; }
        base.setInt('allowance_remaining', Number(left - BigInt(amount)));
        q("UPDATE refills SET reserved=1, state='approved', updated_at=? WHERE id=?").run(now(), id);
        db.exec('COMMIT'); return true;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    releaseRefill: (id) => { // only when OutLayer says nothing was submitted
      const r = s.refill(id); if (!r || !r.reserved) return;
      base.setInt('allowance_remaining', base.getInt('allowance_remaining', 0) + r.amount);
      q('UPDATE refills SET reserved=0 WHERE id=?').run(id);
    },
  };
  return s;
}
