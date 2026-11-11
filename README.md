# Carry

Work in progress for the NEAR Hackathon.

Copyright 2026 AjKadri. Licensed under Apache-2.0 (see `LICENSE`).

## What exists today

- **Pay link** (`/pay/:handle`): a client enters an amount and their Solana address and gets a 1Click deposit address (USDC on Solana, delivered to the reserve's *confidential* balance, using the 1Click partner key; no reserve key is involved). The service tracks arrivals through 1Click `/v0/status` and logs "payment_in".
- **Guard** (`server/guard.js`): a pure, unit-tested function that decides which pending OutLayer approvals Carry's approver may vote on. It approves only (a) a confidential transfer of USDC to the pocket that keeps the pocket under the phone ceiling and within the remaining total-refill allowance, and (b) the stored bill (exact payee, exact amount, unused, before expiry). Everything else gets no vote and a logged reason.
- **Refill engine** (`server/engine.js`): one refill at a time, sized from the pocket's real balance, idempotent per arrival, state kept in SQLite. Each refill is requested, checked by the guard, the allowance is reserved, the approver votes, and the result is confirmed. Every step is logged.
- A refill moves min(refill allowance, reserve balance, ceiling headroom) from the reserve, independent of the payment amount after fees.
- **Pre-approved bill**: stored from the home app; the phone triggers it by id only.
- **Two apps, two ports.** The *home* app (bills, refill allowance, reserve balance, full log) accepts loopback connections only. The *public* app (pay page, phone API) has no route that creates a bill, changes an amount, raises the allowance or reads the reserve. Tests check this.
- **Mock mode** (default, no keys): an in-memory stand-in for OutLayer and 1Click that speaks the same request shapes and verifies vote signatures. It proves the code paths, not mainnet.
- SQLite activity log (`node:sqlite`, Node 22.13+), React (Vite) web app with plain placeholder styling.

## Run it

```bash
npm install
npm run demo
```

Open http://127.0.0.1:8787/home (home), http://127.0.0.1:8788/pay/demo (pay link) and http://127.0.0.1:8788/phone (phone). In mock mode the pay page has a "simulate this payment" button.

```bash
npm test
```

## Live mode

`CARRY_MODE=live` needs the keys in `.env.example`. It starts with a refill allowance of 0, so nothing moves until the owner sets one on the home app. At start it logs each wallet's policy version and locked state. Live mode has so far been run read-only (wallet state, balances, issuing a deposit address).

## Known limits (so far)

- The service holds the pocket key to read the pocket balance. A stolen service host therefore gets the pocket's caps and what the reserve policy allows, not the reserve.
- OutLayer accepts any vote from the pinned signer key, so Carry's guard is the only thing deciding what is auto-approved. The approver key cannot be rotated once the reserve policy is locked.
- The home app has no login yet; it relies on loopback.
- The pay page supports USDC on Solana only.

## Roadmap (not built)

`npm run attack`, home login (passkey), pairing, animations and final design, deployment behind a reverse proxy.

## Disclosure

Libraries: express, react, react-dom, vite, @vitejs/plugin-react. Code in this repo is AI-assisted.
