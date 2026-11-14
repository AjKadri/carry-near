// Source chains the pay link can receive from. Every route delivers USDC (NEAR) to the reserve's confidential balance.
// A chain is offered only if 1Click's /v0/tokens lists its asset (see listedChains), so the page never offers a route 1Click cannot take.
import crypto from 'node:crypto';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
  const bytes = n === 0n ? [] : [...Buffer.from(hex, 'hex')];
  for (const c of s) { if (c === '1') bytes.unshift(0); else break; }
  return Buffer.from(bytes);
}

export const validSolana = (a) => {
  if (typeof a !== 'string' || !a) return 'Enter your Solana address (base58, 32 to 44 characters).';
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'That is not a Solana address. It is 32 to 44 characters of letters and digits, without 0, O, I or l.';
  const d = b58decode(a);
  return d && d.length === 32 ? null : 'That is not a valid Solana address (it must decode to 32 bytes).';
};
// EVM: 0x + 40 hex digits. Mixed-case EIP-55 checksums are not verified (needs keccak-256, not in Node's crypto); an all-lowercase or all-uppercase address is accepted.
export const validEvm = (a) => (typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) ? null : 'That is not an EVM address. It starts with 0x followed by 40 hexadecimal digits.');
// Tron: base58check, 21 bytes starting 0x41 plus a 4-byte double-SHA256 checksum, always starting with T.
export const validTron = (a) => {
  if (typeof a !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return 'That is not a Tron address. It starts with T and is 34 characters long.';
  const d = b58decode(a);
  if (!d || d.length !== 25 || d[0] !== 0x41) return 'That is not a valid Tron address.';
  const sum = crypto.createHash('sha256').update(crypto.createHash('sha256').update(d.subarray(0, 21)).digest()).digest().subarray(0, 4);
  return sum.equals(d.subarray(21)) ? null : 'That Tron address has a typo (its checksum does not match). Check it and try again.';
};

export const CHAINS = [
  { id: 'sol-usdc', chain: 'Solana', symbol: 'USDC', label: 'USDC on Solana', assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', addressName: 'Solana address', validate: validSolana },
  { id: 'base-usdc', chain: 'Base', symbol: 'USDC', label: 'USDC on Base', assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', addressName: 'Base (EVM) address', validate: validEvm },
  { id: 'arb-usdc', chain: 'Arbitrum', symbol: 'USDC', label: 'USDC on Arbitrum', assetId: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', addressName: 'Arbitrum (EVM) address', validate: validEvm },
  { id: 'eth-usdc', chain: 'Ethereum', symbol: 'USDC', label: 'USDC on Ethereum', assetId: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near', addressName: 'Ethereum (EVM) address', validate: validEvm },
  { id: 'tron-usdt', chain: 'Tron', symbol: 'USDT', label: 'USDT on Tron', assetId: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near', addressName: 'Tron address', validate: validTron },
];
export const chainById = (id) => CHAINS.find((c) => c.id === id);
// Keep only the chains whose asset 1Click's /v0/tokens lists with the same symbol and 6 decimals.
export const listedChains = (tokens) => CHAINS.filter((c) => Array.isArray(tokens) && tokens.some((t) => t.assetId === c.assetId && t.symbol === c.symbol && t.decimals === 6));

// Well-formed sample wallets used ONLY for dry quotes (1Click refuses a token contract as refundTo, so these are ordinary public wallets).
// Nothing is ever sent to them: a dry quote reserves no address and moves no money.
export const SAMPLE_REFUND = {
  'sol-usdc': '7puyGCiSnh55z3EzWEr8MKDBw9FYH2izq4K4mXPNpcuo',
  'base-usdc': '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  'arb-usdc': '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  'eth-usdc': '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  'tron-usdt': 'TVjpchRyV9wdpj6kmwqVsBDWY1J8PaFtnb',
};
