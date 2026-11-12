# Mainnet records, with where each one comes from

Everything here was read from the spike notes (`carry-spike/SPIKE.md`, a sibling folder outside this repository) and the evidence files next to it. Nothing was looked up again for this file. Wallet account ids are left out on purpose.

## A real payment into the pay-link flow (Solana, USDC)

- Solana transaction, 1 USDC from the owner's Solana wallet to a 1Click deposit address, 9 Nov 2026 about 16:11-16:20 UTC:
  https://solscan.io/tx/ppa1Qx1ciR71GxZGGiMzzncwxdGNNGV83cwHDB6KAy992uWzUwQhY1GBALrRyjYBRHx8QoTw17x6xUJBEvUH8xA
- It settled to the reserve's confidential balance in under 9 minutes (balance read back: 999798 micro-USDC, i.e. 0.999798 USDC after fees).
- Taken from: `carry-spike/SPIKE.md`, section "T1 deposit leg", and the full hash in `carry-spike/evidence/T1-trace-1794241711892.json` (and `...1227046.json`).

## Carry's own live end-to-end run (payment, then refill, no human tap)

Wed 11 Nov 2026 11:02-11:03 UTC, Carry running in live mode. Taken from `carry-spike/SPIKE.md`, section "Live end-to-end B+C", run log `carry-spike/evidence/live-e2e-2026-11-11.log`:

- payment_in 0.999798 USDC (11:02:52, 1Click status SUCCESS)
- refill_planned 1.000000, refill_requested, guard_decision REFILL_OK, approver vote HTTP 200 (11:02:58.9), refill_success (11:03:03): about 8 s from detection to money in the pocket
- end state: reserve 0.479596, pocket 1.22 USDC, allowance 0, no refused or failed events

The explorer transaction hashes for this run are not recorded in `SPIKE.md` or in the evidence files, so there is no explorer link for it here. A second live refill, from the 11 Nov 2026 live attack run (B8), is recorded as OutLayer request `b4d1fe29-1ee7-4e07-a103-f58ce68f65ae` (state success, 0.030000 USDC reserve to pocket); no chain hash was saved for it either. See `evidence/attack-live-2026-11-11T13-01-32-880Z.txt`.

## A refill's public trail (NearBlocks)

From `carry-spike/SPIKE.md`, section "T1 refill leg completed", 9 Nov 2026 16:30-16:32 UTC (request `9aeba970…`): a confidential withdrawal of 0.25 USDC from the reserve to the pocket left two public `execute_intents` transactions on NEAR, `Ctf1jaTE…` and `76u18TFg…`. The notes record only these shortened hashes, so they cannot be turned into links without looking them up again. The notes' finding: neither transaction names the reserve account or the deposit address.
