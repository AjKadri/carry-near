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
