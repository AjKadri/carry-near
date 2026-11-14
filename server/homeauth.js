// Home authentication: ONE laptop device key. The browser holds a NON-EXTRACTABLE ECDSA P-256 private key;
// the server stores only the public key. Every home request is signed over
//   CARRY1 \n METHOD \n path+query \n sha256(body) \n timestamp(ms) \n nonce
// and rejected if the signature is wrong, the timestamp is more than 60 s off, or the nonce was already used.
// Anything that fails is answered 401 {"error":"unauthorized"} (no detail) and logged as home_blocked.
import crypto from 'node:crypto';

export const MAX_SKEW_MS = 60_000;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes
const KEY = 'home_public_key';

export const canonical = ({ method, path, body, time, nonce }) =>
  ['CARRY1', method.toUpperCase(), path, crypto.createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex'), String(time), nonce].join('\n');

export function makeHomeAuth({ store, now = Date.now }) {
  let setupCode = null, setupAttempts = 0, blockedThisMinute = { minute: 0, n: 0 };
  const newCode = () => Array.from(crypto.randomBytes(10), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  const publicKey = () => { const b64 = store.getStr(KEY); return b64 ? crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' }) : null; };
  const auth = {
    registered: () => store.getStr(KEY) !== null,
    now: () => now(),
    // sha256 of the registered public key (DER), hex. Public information; lets a browser ask "is MY key the registered one?" without signing anything.
    fingerprint() { const b64 = store.getStr(KEY); return b64 ? crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex') : null; },
    // Printed on the server console at start while no key is registered. Never sent over the network.
    setupCode() { if (auth.registered()) return null; return (setupCode ??= newCode()); },
    register({ publicKeySpkiB64, code }) {
      if (auth.registered()) return { ok: false, status: 409, error: 'already set up' };
      if (setupAttempts >= 5) return { ok: false, status: 429, error: 'too many attempts; restart the server for a new setup code' };
      const want = auth.setupCode();
      const a = Buffer.from(String(code ?? '').toUpperCase().replace(/[-\s]/g, '')), b = Buffer.from(want);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { setupAttempts++; store.log('home_setup_failed', null, { attempts: setupAttempts }, false); return { ok: false, status: 403, error: 'wrong setup code' }; }
      try {
        const der = Buffer.from(String(publicKeySpkiB64), 'base64');
        const k = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
        if (k.asymmetricKeyType !== 'ec' || k.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return { ok: false, status: 400, error: 'key must be ECDSA P-256' };
        store.setStr(KEY, der.toString('base64'));
      } catch { return { ok: false, status: 400, error: 'unreadable public key' }; }
      setupCode = null; store.log('home_key_registered', null, {}, true);
      return { ok: true };
    },
    reset() { store.delKey(KEY); setupCode = null; setupAttempts = 0; }, // used by `npm run reset-home-key`, not by any route
    // Returns null if the request is genuinely signed by the laptop key, else a short reason (logged, never sent to the client).
    check(req) {
      const k = publicKey(); if (!k) return 'no_key_registered';
      const time = Number(req.get('x-carry-time')), nonce = req.get('x-carry-nonce') ?? '', sigB64 = req.get('x-carry-sig') ?? '';
      if (!Number.isFinite(time) || !NONCE_RE.test(nonce) || !sigB64) return 'missing_or_malformed_headers';
      if (Math.abs(now() - time) > MAX_SKEW_MS) return 'stale_timestamp';
      const msg = canonical({ method: req.method, path: req.originalUrl, body: req.rawBody, time, nonce });
      let ok = false;
      try { ok = crypto.verify('sha256', Buffer.from(msg), { key: k, dsaEncoding: 'ieee-p1363' }, Buffer.from(sigB64, 'base64')); } catch { ok = false; }
      if (!ok) return 'bad_signature';
      store.raw.prepare('DELETE FROM nonces WHERE expires < ?').run(now());
      const fresh = store.raw.prepare('INSERT OR IGNORE INTO nonces (nonce, expires) VALUES (?, ?)').run(nonce, now() + 2 * MAX_SKEW_MS).changes === 1;
      return fresh ? null : 'replayed_nonce';
    },
    middleware: (req, res, next) => {
      const reason = auth.check(req);
      if (!reason) return next();
      const minute = Math.floor(now() / 60000);
      if (blockedThisMinute.minute !== minute) blockedThisMinute = { minute, n: 0 };
      if (++blockedThisMinute.n <= 20) store.log('home_blocked', null, { reason, method: req.method, route: req.path, ip: req.ip }, false);
      else if (blockedThisMinute.n === 21) store.log('home_blocked_flood', null, { note: 'more than 20 blocked requests this minute; further ones are not logged individually' }, false);
      res.status(401).json({ error: 'unauthorized' });
    },
  };
  return auth;
}

// A device key made with Node's crypto, signing exactly like the browser does. For tests and the attack script only.
export function makeTestDevice() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const sign = ({ method, path, body = '', time = Date.now(), nonce = crypto.randomBytes(16).toString('base64url') }) => ({
    'x-carry-time': String(time), 'x-carry-nonce': nonce,
    'x-carry-sig': crypto.sign('sha256', Buffer.from(canonical({ method, path, body: Buffer.from(body), time, nonce })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64'),
  });
  return { publicKeySpkiB64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), sign };
}
