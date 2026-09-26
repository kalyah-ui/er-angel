#!/usr/bin/env bash
# Sets the nurse dashboard password on the server. The password is typed here
# (hidden), hashed with Caddy (bcrypt) and stored only as a hash in .env --
# never written or printed in plain text.
#
#   ssh -t root@<server> bash /opt/er-angel/deploy/set-dashboard-password.sh
set -euo pipefail

ENV_FILE="${1:-/opt/er-angel/.env}"
[ -w "$ENV_FILE" ] || { echo "Can't write $ENV_FILE (run as root)."; exit 1; }

read -rsp "New dashboard password: " pw; echo
read -rsp "Repeat it: " pw2; echo
[ "$pw" = "$pw2" ] || { echo "Passwords don't match -- nothing changed."; exit 1; }
[ "${#pw}" -ge 12 ] || { echo "Use at least 12 characters -- nothing changed."; exit 1; }

# printf is a shell builtin, so the password never shows up in a process list.
hash=$(printf '%s\n' "$pw" | docker run --rm -i caddy:2-alpine caddy hash-password)
unset pw pw2
case "$hash" in
  '$2'*) ;;
  *) echo "Hashing failed -- nothing changed."; exit 1 ;;
esac

tmp=$(mktemp "$ENV_FILE.XXXXXX")
grep -v '^DASHBOARD_PASSWORD_HASH=' "$ENV_FILE" > "$tmp" || true
# Single quotes: the bcrypt hash contains $ signs Docker Compose would expand.
printf "DASHBOARD_PASSWORD_HASH='%s'\n" "$hash" >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"

echo "Dashboard password set."
echo "Apply it with: cd /opt/er-angel && docker compose up -d"
