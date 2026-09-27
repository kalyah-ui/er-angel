#!/usr/bin/env bash
# Creates the hosted kiosk's DEVICE login (separate from the nurse login):
# a random password, stored only as a bcrypt hash in .env. The plain password
# is kept root-only at /root/er-angel-kiosk-device-password (outside the repo)
# for typing into the demo laptops' browser once. It is never printed.
#
#   bash /opt/er-angel/deploy/set-kiosk-device-password.sh           # first time
#   bash /opt/er-angel/deploy/set-kiosk-device-password.sh --rotate  # new password
#
# To read it later (on your laptop):  ssh root@<server> cat /root/er-angel-kiosk-device-password
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/er-angel/.env}"
PASSWORD_FILE="${PASSWORD_FILE:-/root/er-angel-kiosk-device-password}"
USER_NAME="${KIOSK_DEVICE_USER_NAME:-kiosk}"
[ -w "$ENV_FILE" ] || { echo "Can't write $ENV_FILE (run as root)." >&2; exit 1; }

if [ "${1:-}" != "--rotate" ] && grep -q '^KIOSK_DEVICE_PASSWORD_HASH=' "$ENV_FILE" && [ -s "$PASSWORD_FILE" ]; then
  echo "Kiosk device login already set (user '$USER_NAME'). Use --rotate for a new password."
  exit 0
fi

umask 077
# 24 characters from [A-Za-z0-9]: ~143 bits.
password=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)
# printf is a builtin: the password never appears in a process list.
hash=$(printf '%s\n' "$password" | docker run --rm -i caddy:2-alpine caddy hash-password)
case "$hash" in
  '$2'*) ;;
  *) echo "Hashing failed -- nothing changed." >&2; exit 1 ;;
esac

printf '%s\n' "$password" > "$PASSWORD_FILE"
chmod 600 "$PASSWORD_FILE"
unset password

tmp=$(mktemp "$ENV_FILE.XXXXXX")
grep -vE '^KIOSK_DEVICE_(USER|PASSWORD_HASH)=' "$ENV_FILE" > "$tmp" || true
# Single quotes: the bcrypt hash contains $ signs Docker Compose would expand.
printf "KIOSK_DEVICE_USER=%s\nKIOSK_DEVICE_PASSWORD_HASH='%s'\n" "$USER_NAME" "$hash" >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"

echo "Kiosk device login set: user '$USER_NAME'; password saved to $PASSWORD_FILE (root-only, not printed)."
echo "Apply with a deploy (scripts/deploy.ps1)."
