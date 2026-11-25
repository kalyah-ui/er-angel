#!/usr/bin/env bash
# Sets the public hostnames in the server's .env -- the only place they live.
#
#   bash /opt/er-angel/deploy/set-hosts.sh 34-47-40-44.sslip.io
#   bash /opt/er-angel/deploy/set-hosts.sh erangel.health                 # after DNS moves
#   bash /opt/er-angel/deploy/set-hosts.sh <root> <dashboard-host> <kiosk-host>
#
# Writes:
#   SITE_ADDRESS       <root>             (old URL, kept as a dashboard alias)
#   DASHBOARD_ADDRESS  dashboard.<root>
#   KIOSK_ADDRESS      kiosk.<root>
#   CORS_ORIGINS       http://localhost:5173,https://<kiosk-host>
# Each of the three hostnames needs DNS pointing at the server (sslip.io
# subdomains resolve by themselves). Then deploy (scripts/deploy.ps1 or
# bash deploy/remote-deploy.sh) so Caddy and the backend pick them up -- a
# plain container restart does NOT re-read .env.
set -euo pipefail

ROOT="${1:?usage: set-hosts.sh <root-host> [dashboard-host] [kiosk-host]}"
DASHBOARD="${2:-dashboard.$ROOT}"
KIOSK="${3:-kiosk.$ROOT}"
ENV_FILE="${ENV_FILE:-/opt/er-angel/.env}"
[ -w "$ENV_FILE" ] || { echo "Can't write $ENV_FILE (run as the user that owns /opt/er-angel; on a new server, use init-env.sh first)." >&2; exit 1; }

for host in "$ROOT" "$DASHBOARD" "$KIOSK"; do
  [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Not a hostname: $host" >&2; exit 1; }
done

umask 077
tmp=$(mktemp "$ENV_FILE.XXXXXX")
grep -vE '^(SITE_ADDRESS|DASHBOARD_ADDRESS|KIOSK_ADDRESS|CORS_ORIGINS)=' "$ENV_FILE" > "$tmp" || true
{
  echo "SITE_ADDRESS=$ROOT"
  echo "DASHBOARD_ADDRESS=$DASHBOARD"
  echo "KIOSK_ADDRESS=$KIOSK"
  echo "CORS_ORIGINS=http://localhost:5173,https://$KIOSK"
} >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"

echo "Hosts set in $ENV_FILE:"
grep -E '^(SITE_ADDRESS|DASHBOARD_ADDRESS|KIOSK_ADDRESS|CORS_ORIGINS)=' "$ENV_FILE"
