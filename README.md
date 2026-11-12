# Carry

Work in progress for the NEAR Hackathon.

Copyright 2026 AjKadri. Licensed under Apache-2.0 (see `LICENSE`).

## What exists today

- **Pay link** (`/pay/:handle`): a client enters an amount and their Solana address and gets a 1Click deposit address (USDC on Solana, delivered to the reserve's *confidential* balance, using the 1Click partner key; no reserve key is involved). The service tracks arrivals through 1Click `/v0/status` and logs "payment_in".
- **Guard** (`server/guard.js`): a pure, unit-tested function that decides which pending OutLayer approvals Carry's approver may vote on. It approves only (a) a confidential transfer of USDC to the pocket that keeps the pocket under the phone ceiling and within the remaining total-refill allowance, and (b) the stored bill (exact payee, exact amount, unused, before expiry). It also refuses to vote on an approval that has expired or is older than 5 minutes (OutLayer's vote endpoint does not refuse late votes). Everything else gets no vote and a logged reason.
- **Refill engine** (`server/engine.js`): one refill at a time, sized from the pocket's real balance, idempotent per arrival, state kept in SQLite. Each refill is requested, checked by the guard, the allowance is reserved, the approver votes, and the result is confirmed. Every step is logged.
- A refill moves min(refill allowance, reserve balance, ceiling headroom) from the reserve, independent of the payment amount after fees.
- **Pre-approved bill**: stored from the home app; the phone triggers it by id only.
- **Home authentication = one laptop device key.** On first setup the laptop's browser generates a non-extractable ECDSA P-256 key (WebCrypto, kept in IndexedDB); the server stores only the public key. Setup needs a one-time code printed on the server console. Every request under `/api/home/*` (bills, refill allowance, halt, exit request, pairing, reserve balance, full log) must carry a signature over method, path, body hash, timestamp and a one-use nonce. Wrong signature, a timestamp more than 60 s off, a replayed nonce or a tampered body gets a bare 401, and the attempt is logged as `home_blocked`. The signature check runs before the route table, so nothing unsigned reaches a home route. The phone API has no route that creates a bill, changes an amount, raises the allowance or reads the reserve.
- **Phone pairing**: the laptop shows a QR and a confirmation code; the phone claims it and shows the same code; only after the laptop user confirms does the phone receive its pocket credential, once. The phone gets nothing else.
- **Design ("Colour rooms")**: flat blocks of cobalt, emerald and ink on a paper base, one colour per section; Archivo (uppercase, heavy, tight) for display and body, JetBrains Mono for amounts and IDs. Every colour, font, size and motion value is in `web/src/tokens.css`; a test fails if a literal colour appears anywhere else. Red is used only for refusals and blocked attempts. Motion explains money: the payday split (one incoming line forks; the pocket's share goes to the pocket, the rest drops into the black "Protected" band, which shows no amount on the phone), a refusal (the amount bounces back with the raw reason), a refill (tiles pop into the pocket) and rent (the bill tile flips to "Paid"). With `prefers-reduced-motion` every screen shows its final state with no animation.
- **The phone never shows a reserve amount**: not in text, in the DOM, or in any API response the phone view loads. `test/phone-privacy.test.js` fails if it does.
- **`npm run attack`**: replays 30+ attack cases (phone tries to exceed caps, create or edit a bill, raise the allowance; leaked reserve key; altered bill amount and payee; second and simultaneous bill use; wrong-key, replayed, second and expired approval votes; refills above the allowance or ceiling, while halted or frozen; two triggers for one arrival). One PASS/FAIL line per case with the raw refusal; each refused request is shown still pending with balances unchanged. The recorded output is in `evidence/`. Mock output says it is not mainnet.
- **Mock mode** (default, no keys): an in-memory stand-in for OutLayer and 1Click that speaks the same request shapes and verifies vote signatures. It proves the code paths, not mainnet.
- SQLite activity log (`node:sqlite`, Node 22.13+) and a React (Vite) web app styled as the "Colour rooms" design above.

## Run it

Needs Node 22.13 or newer. No keys, no network: `npm run demo` forces mock mode and a throwaway database (`data/demo.db`).

```bash
npm install
npm run demo
```

The terminal prints a one-time setup code. Then:

1. **Home.** Open http://127.0.0.1:8787/home, type the setup code and press "Set up". You see a black "Reserve" room with 0.00 USDC and, further down, "Refills left: 3.00 USDC". Mock mode starts with a demo refill allowance of 3 USDC (set `CARRY_DEMO_ALLOWANCE_USDC` to change it; live mode always starts at 0).
2. **First payment.** In a second tab open http://127.0.0.1:8787/pay/demo. The amount is already 5. Type any Solana address (for example `7puyGCiSnh55z3EzWEr8MKDBw9FYH2izq4K4mXPNpcuo`), press "Get payment address", then press "Mock: simulate this payment". The page changes to "Payment received".
3. **Payday split.** Back on Home, after a few seconds the Payday panel shows one incoming line of 5.00 forking into **Pocket +3.00** (emerald) and **Protected +2.00** (black). The Reserve now reads 2.00 USDC and the Pocket 3.00 / 20.00. Press "Replay" to watch the split again.
4. **Pair the phone view.** The phone is paired from Home. On Home press "Pair phone": a QR code appears with a "pairing link" under it. With a real phone you scan the QR (see below). On the same machine, right-click "pairing link", copy the link address, and open it in a **private window** (or a second browser): that window is "the phone". It shows a 6-digit code; Home shows the same code. Press "Yes, same code: pair it" on Home. The private window says "Paired" and offers "Open the pocket".
5. **Phone view.** In that window open http://127.0.0.1:8787/phone. It shows Pocket 3.00 USDC, "Holds up to 20.00 USDC", "Sends up to 10.00 at a time", the same Payday split with the black band labelled only "Protected" (never an amount), a Send form and the bills. Type any recipient (`someone.near`), amount 11, press "Send": a red slab says "Blocked: this phone can send at most 10.00 USDC at a time." with the raw refusal below it.
6. **Rent (optional).** On Home, "Pre-approved bill": Id `rent`, Payee `d7041ab1063b3f017ae4d43857b225c2897b0d39682cbd2048c539a04b4805a4` (the mock landlord, which is on the mock reserve's whitelist), Amount 15, Expires `2030-01-01T00:00:00Z`, press "Save bill". Make a second payment of 20 on the pay page (step 2) so the reserve holds at least 15, then on the phone view press "Pay" on the Rent tile: it flips to "Paid".

Other pages: the pay link is http://127.0.0.1:8787/pay/demo and the activity log is at the bottom of Home. With `prefers-reduced-motion` every screen shows its final state with no animation.

**Using a real phone.** Home must be opened on the laptop at `http://127.0.0.1:8787/home`. To let a phone reach the pairing page, bind to the network and tell Carry its public address, and do the first setup before anyone else can reach the server:

```bash
HOST=0.0.0.0 CARRY_PUBLIC_URL=http://192.168.1.20:8787 npm run demo
```

Replace `192.168.1.20` with the laptop's address on your Wi-Fi. `CARRY_PUBLIC_URL` is the base address put in the QR code. The phone and the laptop must be on the same network. Home routes still need the laptop's signature, but anyone on that network can reach the pay and phone pages, so use it for a demo only.

```bash
npm test          # unit tests
npm run attack    # the attack replay in mock mode
npm run contrast  # WCAG contrast for every text/background pair
```

## Live mode

`CARRY_MODE=live` needs the keys in `.env.example`. It starts with a refill allowance of 0, so nothing moves until the owner sets one on the home page. At start it logs each wallet's policy version and locked state. Live mode has been run against mainnet with the locked reserve and pocket wallets: one end-to-end payment and refill, and four recorded live attack runs (see "Attack results" and "Mainnet evidence" below). The deployment at carry.ajkadri.dev runs in live mode.

## Attack results

`npm run attack` runs every case against an in-process mock of OutLayer and 1Click. `npm run attack -- --live --yes` runs the same cases against the real locked mainnet wallets with tiny amounts (a spend cap of 0.25 USDC). Every run writes a file to `evidence/` with one PASS/FAIL line per case.

| Run | Summary line | File |
|---|---|---|
| Newest mock run (12 Nov 2026) | `38 PASS, 0 FAIL, 2 SKIP, 1 INFO` | `evidence/attack-mock-2026-11-12T21-29-18-262Z.txt` |
| Mock run on the deployed VPS code (11 Nov 2026) | `38 PASS, 0 FAIL, 2 SKIP, 1 INFO` | `evidence/attack-mock-deployed-vps-2026-11-11T20-04-48Z.txt` |
| Live run 1 (11 Nov 2026, mainnet) | `26 PASS, 0 FAIL, 2 SKIP, 1 INFO, 1 FINDING` | `evidence/attack-live-2026-11-11T12-47-16-288Z.txt` |
| Live run 2, resume (B5, B7, B8) | `3 PASS, 0 FAIL, 0 SKIP, 0 INFO` | `evidence/attack-live-2026-11-11T13-01-32-880Z.txt` |
| Live run 3 (D7) | `1 PASS, 0 FAIL, 0 SKIP, 0 INFO` | `evidence/attack-live-2026-11-11T13-18-10-036Z.txt` |
| Live run 4 (C6a-c, H1-H6) | `9 PASS, 0 FAIL, 0 SKIP, 0 INFO` | `evidence/attack-live-2026-11-11T13-24-17-606Z.txt` |

Live runs 1 and 2 together are 29 PASS, 0 FAIL, 1 FINDING; with runs 3 and 4 the live total is 39 PASS, 0 FAIL. Cases skipped live (A9, C6d) are covered by the mock run; A5 (the phone's daily cap) is marked INFO because it needs 20 USDC to run live, and a daily-cap refusal was seen live earlier (see SPIKE notes, T7b). Mock results prove the code paths and refusal logic, not mainnet.

**The D5 finding.** Case D5 votes on an approval that has already expired. OutLayer's vote endpoint accepted the vote (HTTP 200, approval status "approved"). Expiry is enforced later, by the executor: the request then ended "failed" with `Approval expired before execution`, and nothing moved. So OutLayer does not refuse a late vote. Carry therefore refuses to vote on an expired approval, or one older than 5 minutes, itself (`server/guard.js`, `APPROVAL_MAX_AGE_MS`); case D7 shows that refusal live. The run stopped at D5 as planned, and an addendum at the end of the run 1 file corrects the first wording of the finding.

Three raw refusals from live run 1, copied unchanged from `evidence/attack-live-2026-11-11T12-47-16-288Z.txt`:

```text
A1  phone sends 11 USDC (per-tx cap 10)
    HTTP 403 {"error":"policy_denied","message":"Per-transaction limit exceeded for nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1: 11000000 > 10000000"}
A3  phone withdraws another token (wNEAR)
    HTTP 403 {"error":"policy_denied","message":"Token 'nep141:wrap.near' is not allowed by policy"}
D2  vote by a real full-access key of a non-approver account
    HTTP 403 {"error":"not_approver","message":"2124a543674f54198ca7349b8d6bad042c48ecb71c9143dba387d4758e3550f7 is not an approver of this wallet's policy"}
```

## Mainnet evidence

- A real 1 USDC payment on Solana into the pay-link flow: [Solscan](https://solscan.io/tx/ppa1Qx1ciR71GxZGGiMzzncwxdGNNGV83cwHDB6KAy992uWzUwQhY1GBALrRyjYBRHx8QoTw17x6xUJBEvUH8xA). It settled to the reserve's confidential balance in under 9 minutes (0.999798 USDC after fees).
- Carry's own live end-to-end run, 11 Nov 2026 11:02-11:03 UTC: payment 0.999798 USDC detected, refill planned, guard approved, approver voted, money in the pocket about 8 seconds after detection, no human tap. A second live refill of 0.03 USDC (OutLayer request `b4d1fe29-1ee7-4e07-a103-f58ce68f65ae`, state success) is in live run 2.
- **No explorer link for the refills.** The notes and evidence files record the refill request ids and shortened chain hashes only, not full transaction hashes, so I have not linked them rather than guess. Details and sources: `evidence/mainnet-links.md`.

## Deployment

A deployment runs at https://carry.ajkadri.dev (Ubuntu VPS, Caddy for HTTPS, systemd service running as a non-root user on a loopback port). The pay page, phone API and signed home routes are public; every home route needs the laptop key signature. Files and steps are in `deploy/`.

## Known limits (so far)

- The VPS holds the reserve key and the approver key. If the VPS is compromised, the bound is the reserve's locked whitelist and caps: it can only move money to the pocket, the demo landlord and the owner's exit account, at most 20 USDC per transaction and 60 USDC per day. The approver key cannot be rotated once the policy is locked.

- The service holds the pocket key to read the pocket balance. A stolen service host therefore gets the pocket's caps and what the reserve policy allows, not the reserve.
- OutLayer accepts any vote from the pinned signer key, so Carry's guard is the only thing deciding what is auto-approved. The approver key cannot be rotated once the reserve policy is locked.
- Clearing the laptop browser's site data deletes the home key. Funds stay safe (moving them out needs the owner's NEAR admin wallet); you re-pair by running `npm run reset-home-key` on the server and setting up again. A recovery code is on the roadmap.
- The key cannot be read out, but script running in the Carry page itself (for example through a cross-site scripting bug) could ask the browser to sign requests while the page is open.
- Whoever can read the server console during first setup can register the home key, so do the first setup before exposing the server.
- The pay page supports USDC on Solana only.

## Roadmap (not built)

A recovery code for the home key (today, losing the laptop's browser data means re-pairing with `npm run reset-home-key`).

## Disclosure

Libraries: express, react, react-dom, vite, @vitejs/plugin-react, qrcode, and esbuild (dev only, used by the tests to bundle the web components). Code in this repo is AI-assisted.

Fonts (self-hosted from `web/public/fonts/`, no font CDN): **Archivo** (variable, latin subset), Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo), and **JetBrains Mono** (500, latin subset), Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono). Both are licensed under the SIL Open Font License 1.1; the licence texts are in `web/public/fonts/OFL-Archivo.txt` and `OFL-JetBrainsMono.txt`. The font files were taken unmodified from the npm packages `@fontsource-variable/archivo` and `@fontsource/jetbrains-mono`.

Text contrast (WCAG 2.x, all pairs meet AA 4.5:1). `npm run contrast` (`scripts/contrast.js`) reads `web/src/tokens.css`, recomputes every pair below and exits 1 if one drops under 4.5; `test/contrast.test.js` runs it in `npm test`:

| Pair | Colours | Ratio |
|---|---|---|
| Text on paper | ink #0C0D10 on #F3F0E8 | 17.06 |
| Muted on paper | #4B4B53 on #F3F0E8 | 7.59 |
| Text on cobalt | #F3F0E8 on #1B3BCB | 7.28 |
| Muted on cobalt | #CAD3FF on #1B3BCB | 5.63 |
| Text on emerald | #F3F0E8 on #0A6446 | 6.31 |
| Muted on emerald | #CBEBDC on #0A6446 | 5.63 |
| Text on ink | #F3F0E8 on #0C0D10 | 17.06 |
| Muted on ink | #B4B8C4 on #0C0D10 | 9.80 |
| Refusal slab text | #F3F0E8 on #B3121B | 6.11 |
| Blocked row text | #B3121B on #F3F0E8 | 6.11 |
| Buttons (room colour on paper) | cobalt 7.28, emerald 6.31, ink 17.06 | see the script |
