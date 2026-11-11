#!/bin/sh
# Copies the code to /opt/carry on the VPS. Never copies .env, data/ or node_modules.
set -e
HOST="${1:?usage: deploy/deploy.sh <ssh-host>}"
rsync -az --delete --exclude node_modules --exclude data --exclude '.env' --exclude '.env.*' --exclude web/dist --exclude .git --exclude handoff-urls.txt \
  --include .env.example ./ "$HOST:/opt/carry/"
ssh "$HOST" 'chown -R carry:carry /opt/carry'
echo "Copied. Next: ssh $HOST 'cd /opt/carry && sudo -u carry npm ci && sudo -u carry npm run build && systemctl restart carry'"
