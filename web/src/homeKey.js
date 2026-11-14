// The home device's key. ECDSA P-256, generated with extractable=false: the private key can sign but can never be read
// out, not even by this page's own code. It lives in IndexedDB as a CryptoKey object. Clearing the browser's site data
// deletes it (re-pairing is then needed; funds stay safe behind the owner's NEAR admin wallet).
import { clock, syncClock as syncClockOf } from './clock.js';
const DB = 'carry-home', STORE = 'keys', ID = 'device';
const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error); }); };

export const loadKey = () => tx('readonly', (s) => s.get(ID)).catch(() => null);
export const clearKey = () => tx('readwrite', (s) => s.delete(ID));
export async function createKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  await tx('readwrite', (s) => s.put(pair, ID));
  return pair;
}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const publicKeySpkiB64 = async (pair) => b64(await crypto.subtle.exportKey('spki', pair.publicKey));

// ---------------------------------------------------------------------------------------------------------------------
// Signing and sending home requests. Built by a factory so tests can give it a key, a fake clock and a fetch.
export const publicKeyFingerprint = async (pair, subtle = crypto.subtle) => hex(await subtle.digest('SHA-256', await subtle.exportKey('spki', pair.publicKey)));

// What to do after a home request is still refused (401) once the clock has been re-synced and the request retried:
// only a status answer that says this key is not the registered one (or that nothing is registered) counts as "not recognised".
// Anything else (the server unreachable, a matching key, an odd answer) is a transient failure and the page keeps trying.
export const classifyRefusal = (status) => (status && (status.registered === false || status.matches === false) ? 'unrecognised' : 'retry');

export function createHomeClient({ clock: clk = { offset: 0 }, loadKey: load = loadKey, fetchFn = (...a) => fetch(...a), now = () => Date.now(), subtle = crypto.subtle, random = (n) => crypto.getRandomValues(new Uint8Array(n)) } = {}) {
    const c = {
    get offset() { return clk.offset; },
    // From a response's Date header (1 s resolution). Used for the public (unsigned) calls too.
    syncClock(res) { syncClockOf(res, now, clk); },
    // Ask the server for its time (no cache, exact milliseconds) and correct for half the round trip.
    async resyncClock() {
      const t0 = now();
      try {
        const res = await fetchFn('/api/home/auth/status', { cache: 'no-store' });
        const j = await res.json().catch(() => null), t1 = now();
        if (Number.isFinite(j?.serverTime)) { clk.offset = j.serverTime + (t1 - t0) / 2 - t1; return true; }
        c.syncClock(res); return true;
      } catch { return false; }
    },
    // Is the key held by this browser the registered one? { registered, matches } or null if the server could not be reached.
    async keyStatus() {
      try {
        const pair = await load(); if (!pair) return { registered: null, matches: false };
        const res = await fetchFn(`/api/home/auth/status?key=${await publicKeyFingerprint(pair, subtle)}`, { cache: 'no-store' });
        if (res.status !== 200) return null;
        const j = await res.json(); if (Number.isFinite(j?.serverTime)) clk.offset = j.serverTime - now();
        return { registered: !!j.registered, matches: j.matches };
      } catch { return null; }
    },
    // Sign and send ONE home request: method, path+query, sha256(body), time and a one-use nonce. No network failure ever throws: status 0 means "could not reach the server".
    async attempt(path, method, raw, pair) {
      const time = now() + clk.offset, nonce = b64url(random(16));
      const digest = hex(await subtle.digest('SHA-256', new TextEncoder().encode(raw)));
      const msg = ['CARRY1', method.toUpperCase(), path, digest, String(time), nonce].join('\n');
      const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(msg));
      let res; try { res = await fetchFn(path, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Carry-Time': String(time), 'X-Carry-Nonce': nonce, 'X-Carry-Sig': b64(sig) }, body: raw || undefined }); } catch { return { status: 0, body: null }; }
      c.syncClock(res);
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    // A 401 first re-syncs the clock from the server and retries ONCE with a fresh nonce (the usual cause is a stale timestamp), before anything is reported.
    async signedFetch(path, { method = 'GET', body } = {}) {
      const pair = await load();
      if (!pair) throw new Error('no device key in this browser');
      const raw = body === undefined ? '' : JSON.stringify(body);
      const first = await c.attempt(path, method, raw, pair);
      if (first.status !== 401) return first;
      if (!(await c.resyncClock())) return first;
      return { ...(await c.attempt(path, method, raw, pair)), retried: true };
    },
  };
  return c;
}

const home = createHomeClient({ clock });
export const syncClock = home.syncClock;
export const signedFetch = home.signedFetch;
export const keyStatus = home.keyStatus;
