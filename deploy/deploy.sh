#!/bin/sh
# Copies the code to /opt/carry on the VPS. Never copies .env, data/ or node_modules.
set -e
HOST="${1:?usage: deploy/deploy.sh <ssh-host>}"
rsync -az --delete --exclude node_modules --exclude data --exclude '.env' --exclude '.env.*' --exclude web/dist --exclude .git \
  --include .env.example ./ "$HOST:/opt/carry/"
echo "Copied. Next: ssh $HOST 'cd /opt/carry && npm ci && npm run build && sudo systemctl restart carry'"
