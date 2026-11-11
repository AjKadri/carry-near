// The laptop's device key. ECDSA P-256, generated with extractable=false: the private key can sign but can never be read
// out, not even by this page's own code. It lives in IndexedDB as a CryptoKey object. Clearing the browser's site data
// deletes it (re-pairing is then needed; funds stay safe behind the owner's NEAR admin wallet).
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

let offset = 0; // server time minus browser time, from the Date header, so a wrong laptop clock does not break signing
export const syncClock = (res) => { const d = Date.parse(res.headers.get('date') ?? ''); if (Number.isFinite(d)) offset = d - Date.now(); };

// Sign and send one home request. The signature covers method, path+query, sha256(body), time and a one-use nonce.
export async function signedFetch(path, { method = 'GET', body } = {}) {
  const pair = await loadKey();
  if (!pair) throw new Error('no device key in this browser');
  const raw = body === undefined ? '' : JSON.stringify(body);
  const time = Date.now() + offset, nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const digest = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  const msg = ['CARRY1', method.toUpperCase(), path, digest, String(time), nonce].join('\n');
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(msg));
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-Carry-Time': String(time), 'X-Carry-Nonce': nonce, 'X-Carry-Sig': b64(sig) }, body: raw || undefined });
  syncClock(res);
  return { status: res.status, body: await res.json().catch(() => null) };
}
