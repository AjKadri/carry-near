#!/bin/sh
# Deploys the SANDBOX (demo.carry.ajkadri.dev) to /opt/carry-demo. It touches only: /opt/carry-demo, the unit carry-demo.service, and one added site block in
# /etc/caddy/Caddyfile (backed up first, validated, then a graceful reload). It never touches /opt/carry, the carry service, its .env or its data.
# Run from the repo root after `npm run build`:  deploy/deploy-demo.sh root@2.29.11.26
set -e
HOST="${1:?usage: deploy/deploy-demo.sh <ssh-host>}"
[ -f web/dist/index.html ] || { echo "run npm run build first"; exit 1; }
EXPRESS="$(node -p "require('./package-lock.json').packages['node_modules/express'].version")"
ssh "$HOST" 'mkdir -p /opt/carry-demo/web'
rsync -az --delete --exclude '.env*' server/ "$HOST:/opt/carry-demo/server/"
rsync -az --delete web/dist/ "$HOST:/opt/carry-demo/web/dist/"
ssh "$HOST" "cd /opt/carry-demo && printf '%s\n' '{\"name\":\"carry-demo\",\"private\":true,\"type\":\"module\"}' > package.json && npm install --omit=dev --ignore-scripts --no-audit --no-fund express@$EXPRESS >/dev/null && chmod -R go-w /opt/carry-demo"
scp -q deploy/carry-demo.service "$HOST:/etc/systemd/system/carry-demo.service"
# SKIP_CADDY=1 deploys the service only (reachable on the VPS loopback), for when the DNS record does not exist yet.
ssh "$HOST" "SKIP_CADDY=${SKIP_CADDY:-0}; $(cat <<'REMOTE'
set -e
if [ "$SKIP_CADDY" != 1 ] && ! grep -q "^demo.carry.ajkadri.dev" /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-demo-$(date +%Y%m%d%H%M%S)"
  printf "\ndemo.carry.ajkadri.dev {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:8798\n}\n" >> /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile >/dev/null
  systemctl reload caddy
fi
systemctl daemon-reload
systemctl enable --now carry-demo
sleep 2; systemctl is-active carry-demo; curl -s http://127.0.0.1:8798/api/health; echo
REMOTE
)"
echo "Deployed. The DNS A record demo.carry.ajkadri.dev -> the VPS must exist for HTTPS to issue."
