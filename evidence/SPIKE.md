<!-- Copy of the spike notes. Scanned before copying: no API keys, seeds, private keys, wk_ keys, handoff URLs or .env values (see README, "Disclosure"). The VPS address is removed. In this copy, spike/… means evidence/spike/…; run files in carry/data and a few scripts mentioned here are not part of this repository. -->

# Carry — day-one feasibility spike and build notes

Started Mon 9 Nov 2026 ~10:45 UTC. Engineering budget: 6 h. Decision deadline: Mon 9 Nov 22:00 UTC.
Spend cap: **awaiting user approval**. Environment: NEAR mainnet via OutLayer Agent Custody (`api.outlayer.ai`).

## Status
| # | Test | Verdict | Note |
|---|---|---|---|
| T0 | One stable payment address | not run | New. Docs: cross-chain `deposit_address` expires after 30 min. If it can't be stable, the "one address" claim breaks. |
| T1 | Privacy of the split | not run | Manual explorer inspection + tx hashes |
| T2 | Unlocked phone | not run | `npm run t2` + manual handoff-URL check |
| T3 | Refill caps under concurrency | not run | `npm run t3` |
| T4 | Bill tamper | not run | `npm run t4` |
| T5 | Legitimate exit from reserve | not run | Manual, dashboard/controller |

**Blocker:** this cloud workspace's network policy refuses `api.outlayer.ai`, `app.outlayer.ai`, `1click.chaindefuser.com` and `rpc.mainnet.near.org` (proxy 403 on CONNECT). Tests must run from the user's computer.

## Design under test (spike only)
- **Reserve wallet R** (OutLayer, random wallet). Controller = owner on laptop. Policy: `confidential` allowed; transfer whitelist = {pocket P, landlord L}; caps bound total refills; `delete` denied; `approval.locked`.
- **Splitter key S** (R's key or a sub-agent key) runs at home/server; R's policy bounds it to P and L.
- **Pocket wallet P** (separate OutLayer wallet). Phone holds only P's key. Policy: per-tx + daily cap; confidential/swap/cross-chain/delete denied.
- Payment address = R's confidential cross-chain deposit address (see T0).

## Risks found in docs before running (documentation, not observed)
1. **Handoff URL appears to carry the API key itself** (`app.outlayer.ai/wallet?key=wk_...`). If the dashboard grants control to whoever has the `wk_` key, the phone's pocket key also unlocks the pocket's policy → T2 fails for the pocket. Must test whether control binds to the owner after first claim. Same question decides whether R's key can ever leave the laptop.
2. **API key can call `/wallet/v1/delete`**; docs list `delete` as default-deny under a policy but don't confirm. Without a policy a wallet is unrestricted.
3. **Cumulative caps are best-effort under concurrency** (stated). T3 measures it; pocket ceiling must also come from funded balance.
4. **Deposit addresses expire in 30 min** → T0.
5. **Whitelist coverage of `/confidential/transfer` is undocumented** → if R's splitter key can confidentially transfer to anyone, the bound fails. Add to T2 with the reserve key (`RESERVE_KEY_ON_PHONE` path) once the shape of the confidential body is known.
6. No documented policy-denial status code — harness treats any non-2xx or `pending_approval` as refusal and saves raw bodies.

## Pass/fail conditions
As in the handoff §7. T0 added: Go = one address (or a stable equivalent, e.g. a NEAR account ID clients pay via Intents) receives two payments ≥31 min apart into R; Stop = address rotates and no stable route exists → "one address from any chain" must be reworded before building.

## Evidence
(sanitised outputs land in `spike/`; summarise here after each run)

### Policy read-back, Mon 9 Nov ~15:40 UTC (observed, `npm run policy`)
- Both wallets: `locked: true`, approver = owner's NEAR account (admin, threshold 1). Policy changes need owner approval → handoff link alone should not grant control (confirm in T2 manual step).
- Reserve: transfer excluded from approval (auto top-ups run); call + intents_withdraw need approval; delete and swap absent (denied); confidential allowed. **No address whitelist** — dashboard edit after locking did not apply (still version 1). Fix: fresh reserve, whitelist before lock.
- Pocket: per-tx 0.05 NEAR, **hourly** 0.1 (intended daily; fine for T2); confidential not granted (default-deny); call allowed but needs approval.
- Open: whether confidential ops are gated by approval when `confidential` is allowed (UI warns confidential routes aren't bound to policy limits/whitelist).

### T2 run 1, 15:43 UTC (observed; spike/T2-2026-11-09T15-43-13-239Z.json)
- REFUSED by policy (real): pocket over per-tx cap (403 policy_denied); pocket confidential shield (403 "Transaction type 'confidential' is not allowed").
- Harness error, not a breach: "reads confidential balance" read the pocket's OWN (empty) confidential balance. The reserve's balance needs the reserve key. Original FAIL kept; case relabelled informational for run 2.
- BROKEN TEST (400 bad_request, not a refusal): cross-chain withdraw (missing `chain`), swap (asset id needs `nep141:`), delete (missing `beneficiary`). Unresolved until rerun. Delete takes a beneficiary → if allowed it sends the whole balance to any address; must be refused.
- Sub-agent key PUT returned 200 with a DIFFERENT wallet_id/account: it derives a separate sub-wallet, not a second key on the pocket. That wallet is empty and nobody holds the key (we sent a dummy hash). Not an escalation of pocket funds; open question whether the phone can create unpoliced sub-wallets and whether that matters (funds can only reach them through the pocket's capped transfer).
- Manual handoff check: user reports "nothing happened" — awaiting detail.
- lib.js now marks 400 bad_request as `broken-test` so it can never count as a refusal.
- T2 manual handoff check (user, ~15:47 UTC): pocket link opened in a private window showed settings, but saving a change required approval from the owner's NEAR wallet → **PASS**: the `wk_` key in the link does not let its holder change policy. (Observed once, by the user; no screenshot of the prompt.)
- Side note: afterwards the OLD reserve card shows "Edit Policy" greyed out, updated 15:42 UTC, after an accidental click (lock or trash icon). Probably a pending approval request; under investigation.

### T2 run 2, 15:47 UTC (observed; spike/T2-2026-11-09T15-47-47-145Z.json)
All phone-side attempts refused with HTTP 403 `policy_denied`: over-cap transfer; confidential shield ("type 'confidential' not allowed"); intents withdraw ("type 'withdraw' not allowed"); swap; delete. Sub-agent PUT again 200, same derived wallet_id for the same seed (deterministic). Probe in `t2b-subkey.js`.
New reserve registered: b6c985ce…042b (old locked reserve 607059…0161 holds 0.3 NEAR, kept for T5).

### Reserve 3 (66d20f…b0f7), 16:00 UTC (observed via `npm run policy`)
Whitelist {pocket, landlord} stored while unlocked (v1); lock added by a second edit → v2, `locked: true`. Unlocked edits apply; locked edits don't (BUGS.md #1).

### T3 run 1, 16:00 UTC — PASS with limits (spike/T3-2026-11-09T16-00-19-455Z.json)
5 simultaneous 0.04 NEAR top-ups via the reserve key against a 0.1 daily cap: 2 accepted, pocket +0.08 (≤ 0.1). No overshoot observed. Limits: one run, N=5, one burst; OutLayer documents that cumulative limits can be exceeded under concurrency, so the product still sizes the pocket by funded balance, not by the counter alone.

### T4 run 1, 16:00 UTC — confounded (spike/T4-2026-11-09T16-00-21-787Z.json)
- Altered recipient: refused, "Address '…aa' is not in whitelist" → real PASS.
- Original bill, +1 amount, second payment: all refused with "Daily limit exceeded: 0.08 + 0.03 > 0.1" — T3 had already used the day's cap, so these say nothing about the bill. Original-bill FAIL kept; diagnosed as test ordering.
- Rerun with BILL = 0.015 NEAR (fits the 0.02 left today).

### T4 run 2, 16:01 UTC (spike/T4-2026-11-09T16-01-46-925Z.json)
- Altered recipient: refused by whitelist → PASS.
- Altered amount (bill + 1 yocto): **paid** (tx 3AcDgoBhVxzxvFH2EzBn9gjMnLscsLqpK1CgEbNPRtzb). Policy cannot bind a bill's amount.
- Original bill and second payment: refused only by "Daily limit exceeded 0.095… + 0.015 > 0.1" (the tampered payment used the room). Says nothing about "pays once".
- **Verdict T4 (policy alone): FAIL, as predicted.** OutLayer binds the recipient exactly but not the amount or the count. Consequence: the bill rule (fixed amount, once, expiry) must be enforced by Carry's own service holding the bounded reserve key; OutLayer's whitelist + caps are the outer bound if that service is compromised (worst case: up to the daily cap to the pocket or the landlord). The phone never calls OutLayer for the bill; it asks the service. Tamper tests move into `npm run attack` against the service.

### Design tension found (documentation + config, not yet observed)
Reserve's confidential operations are NOT excluded from approval, so a refill out of a confidential balance would wait for the owner each time. Excluding them would make them automatic but unbounded (UI: confidential routes aren't bound to whitelist/caps). Candidate fix: an automated approver (a Carry service account added as `signer`) that approves only top-ups ≤ cap to the pocket and the stored bill; the owner stays the only `admin`. T1 must observe whether confidential withdraw/transfer returns `pending_approval`.

### Reserve 4 + T1 step 1, ~16:09 UTC (observed)
- On reserve 3 (whitelist locked), `confidential/deposit/cross-chain` was refused: "Address 'intents.near' is not in whitelist" → the whitelist DOES apply to this confidential step.
- Reserve 4 (no whitelist, unlocked): same request → HTTP 200, no approval needed. Solana USDC confidential deposit address issued; quote 1.000000 in → 0.999798 out (min 0.9898); **expires_at = 3 days later** (not 30 min as for public cross-chain deposits). Est. 20 s.
- T0 implication: the address still rotates (every ~3 days), so "one address forever" needs a stable front (re-issue before expiry and show the current one, or a different route). To be checked.

### T1 deposit leg, 16:11–16:20 UTC (observed; spike/T1-trace-*.json)
- Solana tx ppa1Qx1c…H8xA: success; payer 7puy…pcuo → deposit address 5Hqq…3bLt, 1 USDC. Visible to anyone (client's chain).
- Reserve confidential balance: 999798 of nep141:17208628…(USDC on NEAR) — settled in < 9 min.
- NearBlocks for reserve 785fc7…18b2: NO FT transactions; only tx is the 0.05 NEAR gas top-up FROM the owner's account c300f0…9b7c → **links reserve to owner publicly** (setup artefact; product must not fund reserve from an identifying account, or must not need gas there).
- Not yet checked: whether the deposit's settlement on NEAR (omft mint / intents) references the reserve or the deposit address.

### T1 refill leg, 16:25 UTC (observed; spike/T1-2026-11-09T16-25-34-316Z.json)
- Run 1 (16:22): refused "Transaction type 'confidential' is not allowed" — `confidential` capability on, but missing from `transaction_types` (dashboard form has no box for it). Added via Policy JSON (reserve 4 still unlocked → v2 applied).
- Run 2: confidential withdraw 0.25 USDC → pocket returned **`pending_approval`** (approval_id 335953b0…). Script's FAIL is a labelling artefact (expected outcome recorded as 'allow'); the observed behaviour is the one predicted: **confidential moves out of the reserve wait for the owner**. Automatic refills therefore need an automated signer-approver (see design tension) or owner taps.
- Side finding: the reserve's `usage.daily` counts the INCOMING 1 USDC deposit as "spent" (sol-omft token). If token caps are set on USDC, incoming pay would eat the refill budget → caps must be on the outgoing token only, or Carry tracks refills itself.
- Refill request efdce596…: approved, then `failed` — "UnsupportedToken(tokenOut is not valid)", `never_submitted: true` (nothing moved). Harness error: asked for the Solana-wrapped token; the reserve holds NEAR-native USDC (17208628…). Fixed.
- Pocket is NOT registered on the NEAR USDC contract (storage_balance_of = null). Delivery to it may fail until registered; watch the rerun.

### T1 refill leg completed, 16:30–16:32 UTC (observed; request 9aeba970…, public txs via NearBlocks API)
- Confidential withdraw 0.25 USDC → pocket: approved by owner → success; pocket received 0.245473 (fee 0.004527 ≈ 1.8% on 0.25; looks fixed-size, re-check on larger amounts). 1Click registered the pocket on the USDC contract itself (storage 0.00125 NEAR paid inside the intent).
- Public trail (both `execute_intents` on intents.near, signer intents.near):
  1. Ctf1jaTE…: account **51e8f94d…7cbe** transfers 250000 USDC to 1Click account 5fb452…ae4a.
  2. 76u18TFg…: 5fb452… `ft_withdraw` 245473 USDC to the pocket; fee 4527 to 609214…92c6.
- Neither the reserve (785fc7…18b2) nor the deposit address appears in either tx. 51e8f94d… was created Feb 2026 by `fomo-solver-test.near` → almost certainly shared shard/relayer infrastructure, not a per-user account (inferred, not confirmed).
- **T1 verdict: PASS with limits (Go).** An outsider sees: the client's payment on its own chain (amount + deposit address), and the pocket's top-up arriving from 1Click. Nothing observed links the payment or the savings to the reserve account. Limits:
  (a) amount/timing correlation: 51e8 sends 0.25 → pocket receives 0.245 two minutes later; with few users the pocket ↔ "a confidential withdrawal of 0.25" link is easy;
  (b) setup leak: the reserve's only public tx is gas from the owner's main account (avoid in product);
  (c) not traced: how the Solana deposit settled on NEAR (whether the deposit-address trail names the reserve) — NearBlocks mt-txns endpoint refused; deferred;
  (d) shard operators see confidential state (documented).

### T2r — stolen reserve key, 16:37 UTC (observed; spike/T2r-2026-11-09T16-37-39-114Z.json)
- Reserve key requests confidential withdraw 0.1 USDC → owner's own main account (not whitelisted): **refused, 403 "Address 'nearhacka.near' is not in whitelist"**. The whitelist DOES bind confidential withdrawals, despite the dashboard's warning that confidential routes aren't bound to policy. PASS.
- Consequence for T5 and the product: the owner's own exit account must be on the reserve's whitelist from the start. New bill payees also need whitelist edits → with locked edits not applying (BUGS.md #1), a locked reserve can't add payees or exits. Bug #1 is now load-bearing: either find the working locked-edit flow, or Carry must decide everything before locking, or keep the reserve unlocked (owner-only edits still require the controller, but without quorum).

### T0 / deposit address under whitelist, 16:39 UTC (observed)
- Reserve 4 now v3, locked, whitelist {pocket, landlord}. New confidential deposit address request: **refused, "Address 'intents.near' is not in whitelist"** — the first (pre-whitelist) request did NOT register anything permanent. Every new deposit address needs `intents.near` reachable.
- With addresses expiring after 3 days, a whitelisted reserve stops being able to accept new pay after 3 days. **T0: FAIL as configured.** Options (user decides): (a) add intents.near to the reserve whitelist (risk to assess: what else a key can send to intents.near); (b) a separate inbox wallet without whitelist issues addresses and sweeps to the reserve (sweep needs approval → automated signer); (c) Carry's service gets 1Click quotes directly with the reserve's confidential identity as recipient, no reserve key involved (feasibility unknown).

## Day-one gate summary (16:40 UTC)
- T1 privacy: PASS with limits → Go. T2 phone: PASS → Go. T2r stolen reserve key: PASS. T3 caps: PASS with limits. T4 bill: policy binds recipient only → bill rule lives in Carry's service. T0 address: FAIL as configured (fix options above). T5 exit: mechanism works (owner-approved confidential withdrawal) but owner's exit account must be whitelisted; not yet run end-to-end.
- Load-bearing open items: locked-policy edits (BUGS #1); deposit-address renewal under whitelist; automated signer-approver for refills.
- Spend so far: 1 USDC test payment (0.75 left in reserve 4, 0.245 in pocket), NEAR gas/funding from owner's account (0.3 old reserve, 0.2 reserve 3, 0.05 reserve 4, 0.1 pocket — recoverable except fees).

### T0c — keyless 1Click confidential quote, 16:52 UTC (observed; spike/t0c.log)
- Dry quote, recipientType INTENTS (public intents balance) for reserve 4, no auth: HTTP 201, amountOut 999798.
- Dry quote, recipientType CONFIDENTIAL_INTENTS, no auth: **HTTP 401 "User authentication is required for confidential intent quotes"**.
- Docs (documentation, not observed): 1Click "user authentication" = `POST /v0/auth/authenticate` with an empty intent signed by the account itself (NEP-413, recipient intents.near) → access token (example 1 h) + refresh token (example 30 days). The quote reference lists only partner auth (X-API-Key / JWT) and doesn't say whether a partner key is enough for a confidential recipient.
- Inference: OutLayer's own deposit-address call most likely signs this user auth as the reserve, which is why it touches intents.near and hits the whitelist. If 1Click needs the RECIPIENT's signature, a fully keyless address isn't possible; the reserve must sign (directly, or once for a refresh token Carry stores). OutLayer warns never to allowlist intents.near for sign_message (a login signature could be replayed to move funds).
- Open: does a partner X-API-Key alone unlock CONFIDENTIAL_INTENTS recipients? Needs a partner key to test.

### T0c — 1Click with partner key, 17:02–17:07 UTC (observed)
- With a 1Click Distribution Channel partner key (X-API-Key) and NO reserve key or signature: dry CONFIDENTIAL_INTENTS quote for reserve 4 → HTTP 201 (was 401 without the key).
- Real quote → deposit address; user sent 1 USDC on Solana; reserve 4 confidential balance went 749798 → **1749596** (+999798). Reserve 4 is locked with whitelist {pocket, landlord} and no intents.near.
- **Verdict: PASS.** Incoming pay reaches a strict, locked reserve's confidential balance via Carry's service holding only a 1Click partner key. The reserve key never touches incoming pay; the whitelist needs no intents.near exception.
- T0 consequence: deposit addresses still expire (we requested a 72 h deadline). Carry's service can re-issue at any time without the reserve key, so the user shares one Carry payment link/page that always shows the current address. README must say "one payment link", not "one permanent address", unless a permanent route is found.
- Limits: one payment; partner key expiry/terms not checked; who can see the settlement on NEAR not traced for this route.

## Day-one result (17:07 UTC)
Gate tests T1 (privacy) and T2 (phone) both Go. Strict reserve + keyless intake works. Remaining before/at start of build: T5 end-to-end exit to owner's own account (needs a reserve whose whitelist includes the owner's exit account, set before locking); automated signer-approver for refills (design); locked-policy edits (BUGS #1).

### T5 — legitimate exit, 17:25 UTC (observed; request b66d5b09…)
Reserve 5 (5f4c49…6263): whitelist {pocket, landlord, nearhacka.near}, no intents.near, confidential type allowed, locked (v2). Funded via 1Click partner-key quote (no reserve key, no gas from owner). Confidential withdraw 0.1 USDC → nearhacka.near: held for owner approval, approved, **success**; 0.095498 delivered (tx 4hBNfLWS…). **T5: PASS.**
Fee check: 0.004502 on 0.1 and 0.004527 on 0.25 → roughly fixed ~0.0045 USDC per withdrawal (negligible on real refills; re-check at $35).

## FINAL day-one verdicts (17:30 UTC)
| Test | Verdict | Delivery viability |
|---|---|---|
| T1 privacy of split | Pass with limits | viable |
| T2 unlocked phone (+T2b sub-key) | Pass | viable |
| T2r stolen reserve key | Pass | viable |
| T3 refill caps (concurrency) | Pass with limits (1 burst, N=5) | viable |
| T4 bill tamper | Policy binds recipient only → bill rule in Carry service | conditional (build it + attack-test it) |
| T0 payment address | Pass via 1Click partner key; address rotates → "payment link" | viable |
| T5 legitimate exit | Pass | viable |
Architecture for the build: reserve wallet (strict whitelist: pocket, bill payees, owner exit; confidential allowed and approval-gated; set everything before locking) + pocket wallet (caps, no confidential) + Carry service holding the 1Click partner key (intake addresses) and a bounded reserve key, with an automated signer-approver for capped refills and the stored bill. Deferred: settlement trace for the deposit leg; partner-key terms/expiry; refill at realistic amounts; locked-edit bug (BUGS #1).
Funds left in test wallets (kept for the build/demo): reserve 4 ≈1.75 USDC, reserve 5 ≈0.90 USDC, pocket 0.245 USDC + NEAR, old reserves NEAR. Approx. spend: 3 USDC in, ~0.02 USDC fees + NEAR gas.

- 1Click partner key (Distribution Channel, label "Carry"): expires 9 Nov 2027 (user, from partner dashboard). Terms not yet read.

## Step B — signer-approver spike, Mon 9 Nov ~22:25 UTC (observed; spike/t6-approver-*.txt, code: approver-lib.js, t6-setup.js, t6-approve.js)

**Result: a signer approver CAN approve over the API with no human. PASS for the mechanism, on a plain transfer.**

How it works (docs: https://api.outlayer.ai/openapi.json, `approveRequest`; then observed):
1. A wallet op that trips approval returns `pending_approval` with `approval_id` and `request_hash`.
2. The service lists what waits with the wallet's own key: `GET /wallet/v1/pending_approvals` (gives `type` and `request_data`: recipient, amount). `GET /wallet/v1/approval/{id}` (no auth) gives `wallet_pubkey` and `request_hash`.
3. The approver signs a NEP-413 message `approve:{approval_id}:{wallet_pubkey}:{request_hash}` with ed25519, recipient `outlayer.near`, a random 32-byte nonce, no callback. Digest = sha256(u32 LE 2^31+413 || borsh{message, nonce, recipient, callback_url=None}).
4. `POST /wallet/v1/approve/{approval_id}` with `{signature (base64), public_key ("ed25519:<b58>"), account_id, nonce (base64)}`. **No API key needed.** HTTP 200 `status: approved, approved 1/1`; the request then runs to `success`.
- The approver is an implicit account (account id = hex of the public key). It must exist on chain with a full-access key, so it needed a small NEAR transfer (0.01) before its key counted. The policy pinned it with `pubkey` and `role: signer`; the owner stayed `admin`; threshold 1; policy unlocked.
- Approvals expire after 24 h; unvoted ones just sit.

Cases (test wallet SPIKE6, policy: whitelist {pocket, owner exit}, approval-gated transfers):
| Case | Guard (Carry-side) | Outcome |
|---|---|---|
| A. 0.003 NEAR to pocket | allow, vote sent | HTTP 200 approved → request `success`. SPIKE6 balance −0.003 (+gas) |
| B. 0.003 NEAR to owner exit (whitelisted, not pocket) | refuse, no vote | request still `pending_approval`; SPIKE6 balance unchanged. PASS |
| C. 0.01 NEAR to pocket (over the test refill cap 0.005) | refuse, no vote | request still `pending_approval`; SPIKE6 balance unchanged. PASS |

**Caveats, stated plainly**
- (a) This run proves the approval flow on a plain NEAR **transfer**. Production refills are **confidential withdrawals**. They pass through the same `pending_approval` step (seen in T1 and T5), but this run does not prove that exact path. **Next check: once a reserve holds USDC, run an auto-approved confidential withdraw to the pocket and a refused one.** Not yet built or tested.
- (b) OutLayer accepts ANY vote signed by the pinned signer key. It does not look at the amount or recipient. **Carry's guard is the only thing deciding what gets auto-approved.** If the approver key leaks, an attacker can approve anything the reserve key has requested and is pending; the real bound is then the reserve's whitelist and caps. Also: someone with the reserve key could request a withdrawal and vote it themselves only if they also hold the approver key. The two keys should live apart. **This goes in the README limits.**
- The guard in `t6-approve.js` is a spike stand-in (recipient = pocket, amount ≤ cap). The production guard must also check type, token, per-arrival idempotency and the remaining total cap.
- Funding the approver from the pocket publicly links the two accounts. Production should fund it some other way.
- Not tested: a vote from a wrong key (expect 401/403), a vote on a locked policy, behaviour if the same approval is voted twice (documented 409).

**Left pending (owner may reject in the dashboard of SPIKE6; they expire in 24 h anyway)**
- ae63e6f3-814c-43ff-a8de-aa4eb18b9a7a: 0.01 NEAR to the pocket (case C)
- 621d002c-1e25-46c5-a2fc-e99c68100f40: 0.003 NEAR to nearhacka.near (case B)

**Verdict for the build:** the automated approver is feasible. The reserve policy lists the owner as `admin` and the Carry approver as a pinned `signer`. Production wallets have NOT been created.

## Day 2 checks (Tue 10 Nov, ~10:50 UTC)
- **Bug #2 withdrawn:** request 9e488513 now reports `status: success`, `oneclick_status: SUCCESS` with full swap details. The status lagged ≥ 20 min after settlement but did resolve. Oddity only: `updated_at` still equals `created_at`. Not filing.
- **Refill fee:** OutLayer confidential withdraw dry-run 35 USDC → pocket: amount_out 35000000 (min 34650000, i.e. 1% slippage bound); 1Click dry quote: amountOut 35000000. The ~0.0045 USDC "fee" seen on day 1 matches the 0.00125 NEAR USDC storage registration paid inside the intent for first-time recipients (pocket, nearhacka.near) — inference; confirm on the next real refill to the already-registered pocket.
- **Deposit-leg public trail** (both test deposits): Solana → omni bridge `fin_transfer` (signer omni-relayer.bridge.near) → a per-deposit 1Click account (a70de4…, 4d981f…) → `execute_intents` transfer of 1.000000 sol-USDC to the shared confidential account **51e8f9…7cbe**. The reserve (785fc7…) and deposit addresses never appear on NEAR. Same shared account is the egress for refills. **Verdict: PASS with limits** — the amount entering the shared pool is public, so amount/timing correlation applies (anonymity set = all confidential-intents users at that time).

## T7 — production wallets, unlocked, Tue 10 Nov 2026 ~14:20–15:00 UTC (observed; code t7.js, log spike/t7.log)
Wallets: pocket `96cb4ed4…6c5f`, reserve `61ffccb3…ebea`, approver `d92a02dc…af44` (pinned signer). Policies as in PROPOSAL-C (confidential only, USDC-keyed caps, allowed_tokens USDC). Both read back v1, unlocked. Funding: 1 USDC Solana → reserve via 1Click partner key (balance 0.999798).

| Check | Result |
|---|---|
| Refill: reserve → pocket `confidential/transfer` 0.5 USDC | `pending_approval` → approver vote HTTP 200 → `success`. 4.1 s total, **no fee** (500000 in, 500000 out), no public trace. PASS |
| Pocket per-tx cap (USDC key) on confidential withdraw, transfer, swap, unshield (11 USDC vs cap 10) | all `403 policy_denied "Per-transaction limit exceeded"` BEFORE the balance check (balance was 0.4). PASS |
| Reserve per-tx cap: transfer 21 USDC (cap 20) | refused, same message. PASS |
| `allowed_tokens`: wNEAR withdraw / transfer (pocket), wNEAR transfer (reserve) | `403 Token 'nep141:wrap.near' is not allowed`. PASS. Intake and refill unaffected |
| Types: pocket `call`, `transfer`, `withdraw`, `intents_transfer` | all `403 type not allowed`. PASS |
| Reserve whitelist on confidential **transfer** and **withdraw** to a non-whitelisted account | both `403 Address … is not in whitelist`. PASS (transfer had not been tested before) |
| Do incoming refills count against the pocket's daily cap? | **No.** After receiving 0.5, pocket `usage.daily` showed only its own outgoing sends. The reserve's usage showed only what it sent out |
| Approver votes | wrong key claiming the approver: 401 `invalid_signature`; right pubkey, bad signature: 401; real full-access key of a non-approver account: 403 `not_approver`; valid vote for A replayed on B: 401; second vote on an approved request: 409 `conflict`. PASS. Guard-skipped request C (to the landlord, whitelisted) stayed `pending_approval`, nothing moved |
| Freeze | Pocket frozen from the dashboard: phone send refused, 403 `wallet_frozen` "Wallet is frozen by controller", balance unchanged. After unfreezing: send worked again (success in 12.8 s). PASS |

**Phone-send latency (for the UI "sending" state):** the API answers in ~1.1–1.4 s with `pending_deposit`; `success` arrives after ~12.5–12.8 s (5 sends, consistent). The UI should expect about 13 s.
**First-recipient fee:** the first send to a recipient that has never received this token costs ≈ 0.0045–0.0046 USDC (0.1 sent → 0.09546 / 0.095398 delivered); a repeat send to the same recipient costs nothing (0.1 → 0.1; dry-runs confirm: fresh account 0.095398, landlord 0.1). **This corrects the "flat ~0.0045 per withdrawal" in T1/T5: those were first sends to new recipients (storage registration netted out), not a flat fee.**

**Findings to carry into the README / design**
1. **Griefing inside the caps.** `swap` and `unshield` are allowed under the `confidential` type (the `swap` capability was not granted yet the swap ran; caps apply to the input). A thief with the phone key can turn pocket USDC into wNEAR (confidential, cannot be withdrawn: not allowed) or unshield it to the pocket's public intents balance (cannot be moved: `intents_transfer`/`withdraw` denied). They gain nothing, but the owner cannot recover it either on a locked policy. Test amounts left stuck: 0.01 USDC swapped (→ 2.698e21 wNEAR units), 0.01 USDC unshielded. Bounded by the pocket's caps. README limit.
2. Pocket daily usage counts every outgoing confidential op (send, swap, unshield) at nominal amount.
3. Approvals that nobody votes on just sit pending (24 h); the guard skipping is safe.
4. Requests can be identical in hash (A and B had the same `request_hash`) but a vote binds the approval id, so replay fails.

**Not tested**
- The pocket DAILY cap and reserve DAILY cap at real scale (balance can't reach 20/60 USDC); only per-tx binding was seen on USDC keys. Daily is the same limit family (native daily binding was observed in T4), but a USDC-keyed daily has not been seen to bind.
- Explicitly denying `swap` (`capabilities.swap.allowed: false`) to see whether it blocks the confidential swap.
- Bill (exact amount/payee/once/expiry) and refill-ceiling guards: Carry service code, not built yet.
- NEAR-origin USDC payment counting against the reserve's daily cap.
- A confidential refill of the reserve's real flow at larger sizes.

**Left pending (reject in dashboards; they expire in 24 h)**: new reserve B `9e18cd9b-b777-43e2-9e66-abfe0061027f` and C `5b3c263d-1b54-4e59-a442-4c5b01bce3c5`; OLD reserve 5 `a392d8b1-ad73-4784-9abe-60f7be080746` (created by a script mix-up that loaded the old wallets' keys; do NOT approve); SPIKE6 `ae63e6f3…`, `621d002c…`.

**Balances now:** reserve 0.489798 USDC, pocket 0.27 USDC (confidential). Landlord received 0.21 USDC in test sends. Spend ≈ 0.03 USDC fees/test losses.

### T7b — pocket daily cap and swap denial, Tue 10 Nov ~15:20 UTC (observed; policy v2: daily 0.3 USDC, `capabilities.swap.allowed:false`)
- **Daily cap binds, USDC-keyed: PASS.** Usage before 0.24 USDC. Swap 0.01 went through (0.25); send 0.05 went through (0.30); then send 0.02, confidential transfer 0.02 and unshield 0.02 were each refused `403 Daily limit exceeded … 300000 + 20000 > 300000`. So the daily cap covers send, transfer and unshield (and swap counts toward it).
- **`capabilities.swap.allowed:false` does NOT block the confidential swap**: the 0.01 USDC swap to wNEAR still ran (HTTP 200, then `pending_deposit`). Confidential swap is governed by the `confidential` type only. Finding 1 of T7 (griefing inside the caps) stays; the swap-deny line is dropped from the final policy because it has no effect. Another 0.01 USDC of test money is now stuck as wNEAR in the pocket.
- Pocket after the test: 0.22 USDC confidential. Policy currently v2 with the 0.3 test cap; it must be re-stored to the final (daily 20) before locking.
- Final pocket policy = `prod-policies/pocket-final.json` (identical to the original `pocket.json`: per-tx 10, daily 20 USDC, confidential only, allowed_tokens USDC, owner admin, `excluded_types:["confidential"]`, no swap line).

## Production wallets LOCKED, Tue 10 Nov 2026 (owner stored the locked policies; read back via API)
- Pocket `96cb4ed4…6c5f`: v4, `locked: true` (approval.locked true). Per-tx 10 / daily 20 USDC, confidential only, allowed_tokens USDC, owner admin, `excluded_types: [confidential]`.
- Reserve `61ffccb3…ebea`: v2, `locked: true`. Per-tx 20 / daily 60 USDC, whitelist {pocket, landlord d7041ab1…, nearhacka.near}, confidential only, owner admin + pinned signer `d92a02dc…af44`, nothing excluded from approval.
- Post-lock check (run afterwards, 0.01 USDC; spike/t7.log): a reserve → pocket refill still went `pending_approval` → approver vote → `success` in 4.6 s on the locked wallets (reserve 0.479798, pocket 0.22 USDC after).
- From here the policies cannot be edited (#37). Approver key cannot be rotated; emergency levers are owner freeze and exit.

- Extra leftover pending approval on the NEW reserve (created 2026-11-10T15:50Z to read the withdraw approval shape, 0.01 USDC to the landlord): cefb7ded-9492-4a44-99b3-2860865c66f0

## Live end-to-end B+C, Wed 11 Nov 2026 11:02–11:03 UTC (observed; carry service in live mode, db carry/data/live.db, run log spike/live-e2e-2026-11-11.log)
Start-of-run wallet state logged by the service: reserve v2 locked=true frozen=false | pocket v4 locked=true frozen=false (11:02:46Z).
Owner sent 1 USDC (Solana, payer 7puy…pcuo) to the pay-link deposit address 8JEbXvcJ…Gi66 (issued 10 Nov 16:35Z). Owner-approved allowance 1 USDC set at 11:02:51Z.
Sequence in the home log: payment_in 0.999798 USDC (11:02:52, 1Click status SUCCESS, Solana tx recorded) → refill_planned 1.000000 (pocket 0.22, reserve 1.479596, allowance 1.0; 11:02:55) → refill_requested (11:02:56) → guard_decision REFILL_OK (11:02:58) → approver vote HTTP 200 (11:02:58.9) → refill_success (11:03:03). About 8 s from detection to money in the pocket; no human tap.
End state: reserve 0.479596, pocket 1.22 USDC, allowance 0, halted none. No refused or failed events; one refill for the arrival.
Not covered by this run: second payment/concurrency live, ceiling cap at real scale, allowance exhaustion live, bill live. (Mock tests cover them; `npm run attack` will re-run the refusal cases live.)

**Refill sizing (one line):** a refill moves min(allowance, reserve balance, ceiling headroom) from the reserve, independent of the payment amount after fees. (Live check, Wed 11 Nov: OutLayer answers a bogus key on the confidential balance with 401 invalid_api_key; the Carry phone routes now return a bare 401 {"error":"unauthorized"}.)

## Live attack run, Wed 11 Nov 2026 12:45–12:47 UTC (evidence: evidence/attack-live-2026-11-11T12-47-16-288Z.txt)
Start: reserve v2 locked, pocket v4 locked, neither frozen. Live spend counter 0.03 USDC (C7 bill 0.02 to our landlord wallet, D3 approval A 0.01 reserve→pocket); cap 0.25.
Result up to D5: 26 PASS, 0 FAIL, 2 SKIP (A9, C6d: mock only), 1 INFO (A5), then D5 stopped the run. Highlights (live, raw refusals in the evidence file): A1–A3 policy_denied; A4 call/transfer/withdraw/intents_transfer "type not allowed"; A6 sub-key is a separate empty wallet; B1–B3, C1–C3 guard refusals with the request still pending and balances unchanged, then approver reject → 200 rejected (the reject path works); B4 not in whitelist; D1 401 invalid_signature; D2 403 not_approver (SPIKE6 signer); D3 replay 401 + legit vote executed; D4 409; D6 pending after 15 s; C7 two simultaneous bill triggers → 200/422 BILL_USED, one payment request, reserve −0.02; C4 second use refused.
**D5 FINDING (observed):** a vote on an EXPIRED approval (SPIKE6 `ae63e6f3…`, expired 10 Nov 22:26Z) was ACCEPTED by `POST /wallet/v1/approve/{id}`: HTTP 200 `{"approval_id":"ae63e6f3-…","status":"approved","approved":1,"required":1,"request_id":"98f62dd1-…"}`. The approval detail had still said `status: pending`. BUT the request then ended `failed` with `result.error: "Approval expired before execution"` (updated 12:47:17Z): the executor enforces expiry, so nothing moved. So: expiry is enforced at execution, not at vote time. My first wording ("expired approvals still executable") was wrong; corrected in the evidence addendum.
Implication for Carry: do not rely on OutLayer to refuse a late vote. The service votes within seconds of requesting, but a cheap hardening is to refuse to vote when the approval's `expires_at` has passed or the request is older than a few minutes.
Not run live (after the stop): B5 (halt), B7 (two triggers for one arrival), B8 (watch-while-running with the owner's ~0.05 USDC payment). Resume with `npm run attack -- --live --yes --only=B5,B7,B8` (D5 is not repeated).
Pay-link minimum lowered to 0.05 USDC after 1Click's dry quote at 12:43Z: 0.05 and 0.1 accepted, 0.01 refused ("Amount is too low for bridge, try at least 9977").

## Live attack run, part 2 (resume), Wed 11 Nov 2026 12:55–13:02 UTC (evidence: newest evidence/attack-live-*.txt; run log carry/data/attack-live-run2.log)
Start: reserve v2 locked, pocket v4 locked, neither frozen; reserve 0.449596, pocket 1.23 USDC. `--only=B5,B7,B8` (D5 not repeated). Result: 3 PASS, 0 FAIL.
- B5 PASS: engine halted, a new arrival created 0 requests and 0 refill rows (halt flag set in-process; the real trigger is in the mock run).
- B7 PASS: concurrent ticks and duplicate polls right after the payment → 1 refill row, 1 OutLayer request, duplicate arrival insert rejected.
- B8 PASS: service already running, allowance 0.03; the owner's payment (0.05 USDC, Solana → pay link) arrived as 0.049988; exactly one refill of 0.030000 (request b4d1fe29-1ee7-4e07-a103-f58ce68f65ae, success); pocket +0.03; reserve 0.449596 → 0.469584 (kept 0.019988); allowance 0.
Live spend counter 0.08 USDC (the owner's 0.05 stays in the system; 0.03 moved reserve → pocket). Across both live runs: 29 PASS, 0 FAIL, 1 FINDING (D5, vote endpoint accepts a late vote; execution refused). Not run live: D7 (stale-approval hardening, mock only so far), A9 and C6d (mock only by design), A5 (INFO).
Balances after (computed from the logged figures: pocket 1.23 + 0.03; reserve as logged): reserve 0.469584, pocket 1.26 USDC confidential. (The T7 swap/unshield remnants are outside this USDC balance.)

## Deployment, Wed 11 Nov 2026 18:38–20:05 UTC (VPS, https://carry.ajkadri.dev)
Service: systemd `carry` as non-root user, loopback port 8797 (8787/8788 were taken), live mode; at start it logged reserve v2 locked=true frozen=false | pocket v4 locked=true frozen=false (18:39:50). Caddy site added after a backup and validation; existing sites unchanged; ufw already allowed 22/80/443 so no rule was changed. Home-key setup done by the owner from the laptop (registered:true, 18:5x–20:0x UTC) while the site was IP-restricted; then opened publicly.
Outside checks (laptop, public URL, 20:04Z): 8 unsigned home routes → 401 {"error":"unauthorized"}; forged signature ×2 → 401; /pay/demo, /phone, /home 200; pay info 200, a real 0.05 USDC quote issued; phone state with no key / wrong key → 401; phone bills 200; bogus pairing claim 404; mock endpoint absent in live (404); CSP and nosniff headers present. Deployed service log shows 8 home_blocked missing_or_malformed_headers + 2 bad_signature. `npm run attack` (mock) run on the VPS: 38 PASS, 0 FAIL, 2 SKIP, 1 INFO (evidence/attack-mock-deployed-vps-*.txt).
Not tested from outside: a genuinely signed request and its replay against the deployed instance (only the owner's browser holds the key); replay is covered by H2 in the mock and live-local attack runs.
Slip: handoff-urls.txt (owner links with wallet keys) was rsynced to the VPS for about a minute and shredded; deploy.sh now excludes it.
Signed-replay check on the deployed instance, Thu 12 Nov 2026 ~08:58 UTC: the owner ran a console snippet in the paired browser (one genuine signed GET /api/home/state, then the identical bytes again). Server log (carry.ajkadri.dev, data/carry.db): one new `home_blocked` entry, reason `replayed_nonce`, route /state, GET, 2026-11-12T08:58:14Z, and no entry for the first request, so the first passed the signature check. (The owner's console printout was not pasted back; the server log is the evidence.)

## Redeploy of Design A (colour rooms), Thu 12 Nov 2026, commit 2aab8c4 (UTC times)
21:14:43Z rsync via deploy/deploy.sh (handoff-urls.txt, .env, data/ not copied; `ls /opt/carry | grep -c handoff` = 0), `npm ci` + `npm run build` as user carry, `systemctl restart carry` at 21:14:56Z. Only the carry service and Carry's own files were touched; Caddy was not changed.
Service log at start (21:14:57Z, live mode): `Wallets: reserve v2 locked=true frozen=false | pocket v4 locked=true frozen=false`, listening on 127.0.0.1:8797.
Outside checks from the laptop (21:15Z): /pay/demo, /phone, /home → 200; /fonts/archivo-latin-wght-normal.woff2 and /fonts/jetbrains-mono-latin-500-normal.woff2 → 200 font/woff2; unsigned GET /api/home/state, GET /api/home/log, POST /api/home/pair/start → 401. Headless Chrome loaded all three pages with the self-hosted fonts (document.fonts.check true; the mono font is requested only on pages that use it, so /phone unpaired does not load it) and logged no console errors or warnings, so no CSP violations.

## Redeploy 2 (demo allowance, phone limits line, pairing link), Thu 12 Nov 2026, carry commit e9a53c1 (UTC times)
21:35:34Z deploy/deploy.sh (no handoff-urls.txt, .env or data/; `ls /opt/carry | grep -c handoff` = 0), `npm ci` + build as user carry, `systemctl restart carry` at 21:35:46Z. Caddy and other services untouched. Live mode still starts at allowance 0 (the demo allowance exists only in the mock branch; the stored live allowance was not changed by the restart).
Service log at start (21:35:47Z): `Wallets: reserve v2 locked=true frozen=false | pocket v4 locked=true frozen=false`, listening on 127.0.0.1:8797.
Outside (21:36Z): /pay/demo, /phone, /home 200; both .woff2 200 font/woff2; unsigned GET /api/home/state, GET /api/home/log, POST /api/home/pair/start 401; POST /api/mock/pay 404 (absent in live); GET /api/phone/state without a key 401. Headless Chrome: self-hosted fonts load, no console errors or warnings on any of the three pages.

## Redeploy 3 (pairing secret in a header), Fri 13 Nov 2026, carry commit 218d273 (UTC times)
08:04:01Z deploy/deploy.sh (no handoff-urls.txt, .env or data/), `npm ci` + build as user carry, `systemctl restart carry` at 08:04:15Z; only Carry's service and files touched. Log at start: `Wallets: reserve v2 locked=true frozen=false | pocket v4 locked=true frozen=false`, listening on 127.0.0.1:8797.
Outside (08:04Z): /pay/demo, /phone, /home 200; both .woff2 200 font/woff2; unsigned GET /api/home/state, GET /api/home/log, POST /api/home/pair/start 401; POST /api/mock/pay 404; GET /api/pair/deadbeef/result?secret=x 404. Headless Chrome: fonts load, no console errors or warnings on all three pages.

## Redeploy 4 (palette, Home summary, activity, pay card, tick resilience), Fri 13 Nov 2026, carry commit 2164258 (UTC times)
11:47:08Z deploy/deploy.sh (no handoff-urls.txt, .env or data/; `ls /opt/carry | grep -c handoff` = 0), `npm ci` + build as user carry, `systemctl restart carry` at 11:47:25Z. Only Carry's service and files touched; Caddy unchanged. Log at start: `Wallets: reserve v2 locked=true frozen=false | pocket v4 locked=true frozen=false`, listening on 127.0.0.1:8797.
Outside (11:47Z): /pay/demo, /phone, /home 200; both .woff2 200 font/woff2; unsigned GET /api/home/state, GET /api/home/log, POST /api/home/pair/start 401; POST /api/mock/pay 404; GET /api/phone/state without a key 401; GET /api/pay/demo now includes `payee`. Headless Chrome: fonts load, no console errors or warnings on all three pages. After the restart the event log (checked 11:48Z) holds only service_start, wallet_state and home_blocked (my unsigned checks): no tick_error or tick_warning.
Related, same day: tick_error diagnosis (33 rows, platform 503s on the balance read; reads now retry and log a soft tick_warning; idle ticks make no balance reads). Two issues filed on out-layer/outlayer with the owner-approved text: https://github.com/out-layer/outlayer/issues/39 (balance 503 every ~4 h) and https://github.com/out-layer/outlayer/issues/40 (vote accepted on an expired approval). Duplicate search first (503, route_unavailable, keystore, expired approval): only #36 (testnet worker-to-keystore, 8 Nov) came up; it is a different problem.
