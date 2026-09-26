#!/usr/bin/env bash
# Merges Object Storage settings (S3_* lines on stdin) into the server's .env,
# replacing any existing S3_* lines. Values are never printed. Used by
# infra/push-storage-keys.ps1:
#
#   <S3_* lines> | ssh root@<server> bash /opt/er-angel/deploy/set-storage-env.sh
set -euo pipefail

ENV_FILE="${1:-/opt/er-angel/.env}"
umask 077

new=$(tr -d '\r' | grep -E '^S3_(ENDPOINT|BUCKET|ACCESS_KEY_ID|SECRET_ACCESS_KEY|REGION)=.+' || true)
for key in S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  grep -q "^$key=" <<<"$new" || { echo "Missing $key on stdin -- nothing changed." >&2; exit 1; }
done

tmp=$(mktemp "$ENV_FILE.XXXXXX")
grep -v '^S3_' "$ENV_FILE" > "$tmp" || true
printf '%s\n' "$new" >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"

echo "Updated $ENV_FILE (values hidden):"
grep '^S3_' "$ENV_FILE" | sed -E 's/=.+/=<set>/'
echo "Apply with: cd /opt/er-angel && docker compose up -d"
