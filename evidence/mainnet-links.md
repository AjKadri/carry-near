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

## 4. A refill with its public trail: the 0.25 USDC refill of 9 Nov 2026 (request `9aeba970-6a94-47fe-9bde-0671e1150349`)

The notes only kept shortened hashes (`Ctf1jaTE…`, `76u18TFg…`). OutLayer's own record of the request has the full ones. Read-only call on 13 Nov 2026, `GET /wallet/v1/requests/9aeba970-6a94-47fe-9bde-0671e1150349` with the key of the wallet that made the request: `status: success`, `amount` 250000, `amount_out` 245473, `submitted_at` 2026-11-09T16:30:20Z, and `swap_details.nearTxHashes` = the two hashes below. Their first characters match the notes' prefixes, so the match is certain. (The request is not visible to the current reserve and pocket keys, which are different wallets; it only answers to the old spike reserve's key.)

| | NEAR transaction | Time (UTC) | NearBlocks |
|---|---|---|---|
| 1 | `Ctf1jaTEJ7HckmQqcjM2eiMEq12d1dWKoZnk16HohGin` | 9 Nov 16:30:24 | https://nearblocks.io/txns/Ctf1jaTEJ7HckmQqcjM2eiMEq12d1dWKoZnk16HohGin |
| 2 | `76u18TFgXdeqw25LaSdMH1VSPKs6Tqjrq8EoxHnh1pX4` | 9 Nov 16:30:27 | https://nearblocks.io/txns/76u18TFgXdeqw25LaSdMH1VSPKs6Tqjrq8EoxHnh1pX4 |

Both are `execute_intents` calls on `intents.near`, signer `intents.near`, status success (read from NearBlocks on 13 Nov 2026; the call arguments were decoded to list the intents).

What a viewer can see in each, from the decoded arguments:

- **Transaction 1:** one `transfer` intent. Signer account `51e8f94d…7cbe` sends 250000 units (0.25 USDC) of the NEAR USDC token (`17208628…33a1`) to the 1Click account `5fb45230…ae4a`. It does not name the pocket.
- **Transaction 2:** two signed intents. Account `824ffeb7…d4c4` transfers a storage amount of wNEAR (0.00125) to `5fb45230…ae4a`. Then `5fb45230…ae4a` makes an `ft_withdraw` of 245473 units (0.245473 USDC) to the pocket account `def6a409…13ba` and a `transfer` of 4527 units (0.004527 USDC, the fee) to `60921495…92c6`. **The pocket is visible here, as the recipient.**
- **The reserve's account id does not appear in either transaction.** I searched the whole NearBlocks response for it for both transactions: not found.
- `51e8f94d…7cbe` and `5fb45230…ae4a` are shared infrastructure accounts, not the reserve or the pocket (the notes record `51e8f94d…` as created by a third-party test account, which is an inference).

What this does not show: how the reserve's confidential balance is linked to account `51e8f94d…7cbe` inside the 1Click and OutLayer systems. Only the public transactions were read.

## 5. The 11 Nov 2026 live refills have no on-chain transaction to link

I also read OutLayer's own records for the two refills Carry itself made on 11 Nov 2026 (read-only, `GET /wallet/v1/requests/<id>` with the reserve key):

| Request | What | Status | `nearTxHashes` | `intent_hash` (OutLayer's own id) |
|---|---|---|---|---|
| `e1a3b4d0-46df-47ee-bcce-876c29f629f6` | e2e refill, 1.000000 USDC reserve to pocket, 11:03 UTC | success | empty | `2Vc1RcU39KViSHJAhq3TFcvc4APuW8sKWRLdEYd2WNMx` |
| `b4d1fe29-1ee7-4e07-a103-f58ce68f65ae` | live attack run B8, 0.030000 USDC, 13:01 UTC | success | empty | `5es9AtGsnjcGHF5RcVCNsAZheimF1MZ7NJJK2LEUztbP` |

Both are `type: confidential_transfer` with `confidential: true`, and the responses carry no transaction hash of any chain (`nearTxHashes`, `originChainTxHashes` and `destinationChainTxHashes` are all empty). They are moves inside the intents system, so there is no NearBlocks transaction to link; that is also why the pocket's own NearBlocks token-transfer list is empty. The `intent_hash` values are OutLayer identifiers, not NEAR transaction hashes, and I did not try to resolve them on an explorer. (`e1a3b4d0…` is from the local live run database, `carry/data/live.db`, which is not in the repository; the request id is the only thing taken from it.)
