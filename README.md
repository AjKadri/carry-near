# Carry

Work in progress for the NEAR Hackathon.

Copyright 2026 AjKadri. Licensed under Apache-2.0 (see `LICENSE`).

## What exists today

A runnable scaffold in **mock mode only**. Nothing here talks to NEAR, OutLayer or 1Click yet.

- Node/Express server with a SQLite activity log (`node:sqlite`, Node 22.13+).
- React (Vite) web app with a Home view (`/home`) and a Phone view (`/phone`).
- "Simulate a payment in" button (mock mode) that credits a simulated reserve.
- The phone endpoint (`/api/phone/state`) returns only pocket data. A test checks it never leaks the reserve.

## Run it

```bash
npm install
npm run demo
```

Open http://127.0.0.1:8787/home and http://127.0.0.1:8787/phone. No keys needed.

```bash
npm test
```

## Roadmap (not built)

Pay page and 1Click intake, refill engine with caps, pre-approved bill, `npm run attack`, home login (passkey), pairing, live mode against OutLayer wallets. The home endpoints currently have no login, so the server listens on loopback only.

## Disclosure

Libraries: express, react, react-dom, vite, @vitejs/plugin-react. Code in this repo is AI-assisted.
