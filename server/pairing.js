// Phone pairing. The laptop (signed home request) starts a session and shows a QR + a confirmation code.
// The phone claims it with the secret from the QR; BOTH screens then show the same code. Only after the laptop
// user confirms does the phone receive its pocket credential, once. The phone never receives anything else.
import crypto from 'node:crypto';

const TTL_MS = 5 * 60e3;
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export function makePairing({ credential, now = Date.now, log = () => {} }) {
  const sessions = new Map();
  const sweep = () => { for (const [id, s] of sessions) if (s.expiresAt < now()) sessions.delete(id); };
  return {
    start() {
      sweep();
      if (sessions.size >= 5) return null;
      const s = { id: crypto.randomBytes(16).toString('hex'), secret: crypto.randomBytes(32).toString('base64url'), state: 'waiting', code: null, attempts: 0, expiresAt: now() + TTL_MS };
      sessions.set(s.id, s); log('pair_started', {});
      return { id: s.id, secret: s.secret, expiresAt: s.expiresAt };
    },
    claim(id, secret) { // phone, public route
      const s = sessions.get(String(id));
      if (!s || s.expiresAt < now()) return { ok: false, status: 404 };
      if (s.attempts >= 5) return { ok: false, status: 429 };
      if (!eq(secret ?? '', s.secret)) { s.attempts++; return { ok: false, status: 403 }; }
      if (s.state !== 'waiting') return { ok: false, status: 409 }; // one claim only
      s.state = 'claimed'; s.code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      log('pair_claimed', {});
      return { ok: true, code: s.code };
    },
    view(id) { // laptop, signed
      const s = sessions.get(String(id));
      if (!s || s.expiresAt < now()) return { state: 'expired' };
      return { state: s.state, code: s.code, expiresAt: s.expiresAt };
    },
    confirm(id) { // laptop, signed
      const s = sessions.get(String(id));
      if (!s || s.expiresAt < now() || s.state !== 'claimed') return false;
      s.state = 'confirmed'; log('pair_confirmed', {}); return true;
    },
    cancel(id) { sessions.delete(String(id)); },
    result(id, secret) { // phone polls; the credential is handed over once, after laptop confirmation
      const s = sessions.get(String(id));
      if (!s || s.expiresAt < now()) return { status: 404, body: { state: 'expired' } };
      if (s.attempts >= 5) return { status: 429, body: { error: 'too many attempts' } };
      if (!eq(secret ?? '', s.secret)) { s.attempts++; return { status: 403, body: { error: 'forbidden' } }; }
      if (s.state !== 'confirmed') return { status: 200, body: { state: s.state, code: s.code } };
      sessions.delete(s.id);
      return { status: 200, body: { state: 'confirmed', ...credential() } };
    },
  };
}
