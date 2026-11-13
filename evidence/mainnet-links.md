# Mainnet records, with where each one comes from

Facts come from `evidence/SPIKE.md` (copy of the spike notes) and the raw files in `evidence/spike/`. Where I re-checked a record on a public explorer on 13 Nov 2026 (read-only, no spend) it says so. Wallet account ids are left out of this file on purpose.

## 1. A 1 USDC payment from Solana (T1 deposit leg, 9 Nov 2026 about 16:11-16:20 UTC)

- Solana transaction: https://solscan.io/tx/ppa1Qx1ciR71GxZGGiMzzncwxdGNNGV83cwHDB6KAy992uWzUwQhY1GBALrRyjYBRHx8QoTw17x6xUJBEvUH8xA
- Source: `evidence/SPIKE.md`, "T1 deposit leg"; full hash in `evidence/spike/T1-trace-1794241711892.json`.
- Re-checked 13 Nov 2026 with the public Solana RPC (`getSignatureStatuses`): finalized, no error, slot 467379927.
- What the notes say a viewer can see: the client's payment on its own chain (amount, payer, 1Click deposit address). The reserve's confidential balance afterwards read 0.999798 USDC (`evidence/spike/T1-trace-1794241711892.json`).

## 2. A second 1 USDC payment and its NEAR settlement (9 Nov 2026 about 17:06 UTC)

1Click's own status record for deposit address `H5Ew1fzkdcJvFUVUCxRk7HWpNimHsbPiGPecybzEd527` is saved in `evidence/spike/day2-1794256499034.json`: status SUCCESS, amountOut 999798, one origin-chain (Solana) hash and two NEAR hashes.

- Solana origin transaction: https://solscan.io/tx/4bTYcp4JTA7RvHkZg6AYtFXa9unKLW9Ri66ZgyVjY5E2jkRnNzLmJ4UfpF9uxAQhvQvErVgNqgcRcu4zVczg6Hvr (re-checked 13 Nov 2026 with the public Solana RPC: finalized, no error, slot 467395030)
- NEAR transaction 1: https://nearblocks.io/txns/55xiL5A25mEQStBVKkJzyN2hJuhzTx6xtyBhCeLAgWHv
- NEAR transaction 2: https://nearblocks.io/txns/68XiTLAhrtWCXgaapw7aUvjaUXcJAcxzUTCpsQvFbQ5L

What NearBlocks showed for the two NEAR transactions on 13 Nov 2026 (only what I read back: signer, receiver, method and time; I could not read their call arguments because the NearBlocks API stopped answering after the first lookups):

| Transaction | Time (UTC) | Signer | Receiver | Method |
|---|---|---|---|---|
| 55xiL5A2… | 9 Nov 17:06:37 | `omni-relayer.bridge.near` | `omni.bridge.near` | `fin_transfer` |
| 68XiTLAh… | 9 Nov 17:06:47 | `intents.near` | `intents.near` | `execute_intents` |

I have **not** verified whether the reserve's account id appears inside either transaction's arguments, so I make no claim about that. The spike notes list this as untraced (`evidence/SPIKE.md`, T1 limit (c)).

## 3. Carry's own live end-to-end run (payment, then refill, no human tap)

Wed 11 Nov 2026 11:02-11:03 UTC, Carry running in live mode. Source: `evidence/SPIKE.md`, "Live end-to-end B+C"; run log `evidence/spike/live-e2e-2026-11-11.log`.

- payment_in 0.999798 USDC (11:02:52, 1Click status SUCCESS)
- refill_planned 1.000000, refill_requested, guard_decision REFILL_OK, approver vote HTTP 200 (11:02:58.9), refill_success (11:03:03): about 8 s from detection to money in the pocket
- end state: reserve 0.479596, pocket 1.22 USDC, allowance 0, no refused or failed events

A second live refill is OutLayer request `b4d1fe29-1ee7-4e07-a103-f58ce68f65ae` (state success, 0.030000 USDC reserve to pocket), from `evidence/attack-live-2026-11-11T13-01-32-880Z.txt`.

## 4. Refill explorer links: not available

For the refills in section 3, and for the 0.25 USDC refill leg of 9 Nov (request `9aeba970…`, `evidence/SPIKE.md` "T1 refill leg completed"), the notes record only shortened hashes (`Ctf1jaTE…`, `76u18TFg…`) and OutLayer request ids, never full transaction hashes. I tried to find the full hashes on NearBlocks on 13 Nov 2026 (read-only):

- the pocket accounts' own transaction and FT-transfer lists return no refill rows (the lists are empty for the token transfers);
- NearBlocks search does not match a hash prefix;
- the token-wide transfer list cannot be filtered to a time window or an account, and the volume makes walking it impractical.

Because a hash could not be matched with certainty, **no refill hash is listed here and none is guessed**. The notes' claim that these transactions involve the shared account `51e8f9…` and not the reserve is therefore recorded in `evidence/SPIKE.md` but not re-verified here. If the owner exports the pocket's history from the NearBlocks website, the matching rows can be added.
