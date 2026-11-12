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
- SQLite activity log (`node:sqlite`, Node 22.13+), React (Vite) web app with plain placeholder styling.

## Run it

```bash
npm install
npm run demo
```

Open http://127.0.0.1:8787/home and enter the one-time setup code printed in the terminal. The pay link is http://127.0.0.1:8787/pay/demo and the phone view is http://127.0.0.1:8787/phone (pair it from Home). In mock mode the pay page has a "simulate this payment" button.

```bash
npm test
```

## Live mode

`CARRY_MODE=live` needs the keys in `.env.example`. It starts with a refill allowance of 0, so nothing moves until the owner sets one on the home page. At start it logs each wallet's policy version and locked state. Live mode has so far been run read-only (wallet state, balances, issuing a deposit address).

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

a recorded live `npm run attack` run, recovery code for the home key, deployment behind a reverse proxy.

## Disclosure

Libraries: express, react, react-dom, vite, @vitejs/plugin-react, qrcode. Code in this repo is AI-assisted.

Fonts (self-hosted from `web/public/fonts/`, no font CDN): **Archivo** (variable, latin subset), Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo), and **JetBrains Mono** (500, latin subset), Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono). Both are licensed under the SIL Open Font License 1.1; the licence texts are in `web/public/fonts/OFL-Archivo.txt` and `OFL-JetBrainsMono.txt`. The font files were taken unmodified from the npm packages `@fontsource-variable/archivo` and `@fontsource/jetbrains-mono`.

Text contrast (WCAG 2.x, all pairs meet AA 4.5:1):

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
