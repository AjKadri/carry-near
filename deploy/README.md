# Deploying Carry to a VPS (Ubuntu + Caddy)

Carry listens on 127.0.0.1:8797 only (8787 and 8788 are taken by other apps on the VPS); Caddy terminates HTTPS and proxies to it. The pay page, the phone API and the signed home routes are all reachable through Caddy; every home route needs the laptop's signature, nothing else reaches them.

1. DNS: an A record for `carry.ajkadri.dev` pointing at the VPS.
2. Server: Node 22.13+ (`node -v`), Caddy installed, a `carry` user (`sudo useradd --system --home /opt/carry --shell /usr/sbin/nologin carry`).
3. Copy the code (not secrets, not `data/`, not `node_modules`): `deploy/deploy.sh <ssh-host>`.
4. On the server: `cd /opt/carry && npm ci && npm run build`.
5. Create `/opt/carry/.env` (mode 600, owner `carry`) from `.env.example` with `CARRY_MODE=live`, the keys, `CARRY_PUBLIC_URL=https://carry.ajkadri.dev`. Never commit it.
6. `sudo install -m 644 deploy/carry.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now carry`
7. `sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy`
8. First setup: `sudo journalctl -u carry | grep -A2 "setup code"`, then open https://carry.ajkadri.dev/home on the laptop and enter the code. Do this before sharing the URL.
9. Set the refill allowance on the home page (live mode starts at 0).

## The public sandbox (demo.carry.ajkadri.dev)

A second service, mock mode only: every visitor gets their own in-memory world behind a random session cookie (up to 500 worlds, least recently used dropped first, 2 hours idle expiry, 30 new worlds per IP per hour). It never loads a key and refuses to start unless `CARRY_MODE=mock` and no live key is in its environment. It listens on 127.0.0.1:8798 and does not share anything with the live service (own directory `/opt/carry-demo`, own systemd unit with a 600 MB memory cap, no `.env`, no database file).

1. DNS: an A record for `demo.carry.ajkadri.dev` pointing at the VPS (without it Caddy cannot get a certificate).
2. `npm run build && deploy/deploy-demo.sh <ssh-host>` copies `server/` and `web/dist/` to `/opt/carry-demo`, installs `express` only, installs `carry-demo.service`, adds the Caddy site block (after a backup and `caddy validate`) and starts it.
3. The live service is not restarted by this. Its landing page (path `/`) only appears after the live service itself is next redeployed with this code (`deploy/deploy.sh`).
