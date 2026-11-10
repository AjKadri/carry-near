// NEP-413 signing/verification for approval votes. Verification exists so the mock OutLayer can be strict.
import crypto from 'node:crypto';

const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58enc(buf) {
  let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0')), s = '';
  while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}
export function b58dec(s) {
  let n = 0n;
  for (const c of s) { const i = ALPHA.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
  const body = Buffer.from(n === 0n ? '' : hex, 'hex');
  return Buffer.concat([Buffer.alloc(s.length - s.replace(/^1+/, '').length), body]);
}
export function newKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  return { account: Buffer.from(pub).toString('hex'), pubkey: 'ed25519:' + b58enc(pub), seed: Buffer.from(seed).toString('hex') };
}
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const str = (s) => { const d = Buffer.from(s); return Buffer.concat([u32(d.length), d]); };
function digest(message, nonce, recipient) {
  // sha256( u32(2^31+413) || borsh{message, nonce[32], recipient, callback_url: Option<String> = None} )
  return crypto.createHash('sha256').update(Buffer.concat([u32(2147484061), str(message), nonce, str(recipient), Buffer.from([0])])).digest();
}
export function signNep413({ seedHex, message, recipient, nonce }) {
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')]);
  return crypto.sign(null, digest(message, nonce, recipient), crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }));
}
export function verifyNep413({ pubkey, message, recipient, nonce, signature }) {
  try {
    const raw = b58dec(pubkey.replace(/^ed25519:/, ''));
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    return crypto.verify(null, digest(message, nonce, recipient), crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }), signature);
  } catch { return false; }
}
