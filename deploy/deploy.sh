#!/usr/bin/env bash
# Zero-touch backend deploy. Invoked by CI (GitHub Actions) or by hand:
#   sudo /srv/gethired/app/deploy/deploy.sh
#
# Pulls main, installs deps, applies migrations, restarts the API — and
# rolls back to the previous commit if the service fails to come up.
set -euo pipefail

APP_DIR=/srv/gethired/app
SERVER_DIR="$APP_DIR/server"
SERVICE=gethired-api

echo "▸ Deploy started $(date -u +%FT%TZ)"

PREV=$(sudo -u gethired git -C "$APP_DIR" rev-parse HEAD)
echo "▸ Current commit: $PREV"

sudo -u gethired git -C "$APP_DIR" fetch --quiet origin main
sudo -u gethired git -C "$APP_DIR" reset --hard --quiet origin/main
NEW=$(sudo -u gethired git -C "$APP_DIR" rev-parse HEAD)
echo "▸ New commit:     $NEW"

if [ "$PREV" = "$NEW" ]; then
  echo "▸ Already up to date — restarting anyway to pick up any env changes."
fi

echo "▸ Installing dependencies…"
sudo -u gethired bash -c "cd $SERVER_DIR && npm ci --no-audit --no-fund --silent"

echo "▸ Applying database migrations…"
sudo -u gethired bash -c "cd $SERVER_DIR && npx prisma migrate deploy"

echo "▸ Restarting $SERVICE…"
sudo systemctl restart "$SERVICE"

# Health gate — roll back if the new code won't boot.
for i in $(seq 1 15); do
  if curl -fsS -m 3 http://127.0.0.1:4000/health >/dev/null 2>&1; then
    echo "▸ Health check passed ✅"
    echo "▸ Deployed $NEW"
    exit 0
  fi
  sleep 2
done

echo "✕ Health check FAILED — rolling back to $PREV"
sudo -u gethired git -C "$APP_DIR" reset --hard --quiet "$PREV"
sudo -u gethired bash -c "cd $SERVER_DIR && npm ci --no-audit --no-fund --silent"
sudo systemctl restart "$SERVICE"
echo "✕ Rolled back. Inspect: sudo journalctl -u $SERVICE -n 50"
exit 1
