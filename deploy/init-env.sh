#!/usr/bin/env bash
# First-time setup of the server's .env, run ON the server as the user that
# owns /opt/er-angel (and is in the docker group):
#
#   bash /opt/er-angel/deploy/init-env.sh 34-47-40-44.sslip.io   # test hostname first
#   bash /opt/er-angel/deploy/set-hosts.sh erangel.health        # later, after DNS moves
#
# Starts from .env.example, generates a fresh KIOSK_TOKEN, asks for the Gemini
# and ElevenLabs keys (hidden input), then sets the hostnames (set-hosts.sh)
# and the dashboard password (set-dashboard-password.sh). No value is printed.
# Object Storage (S3_*) stays unset, so nightly bucket backups are off.
# Refuses to overwrite an existing .env.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

ROOT="${1:?usage: init-env.sh <root-host>   e.g. 34-47-40-44.sslip.io}"
ENV_FILE="$PWD/.env"

[ ! -e "$ENV_FILE" ] || { echo "$ENV_FILE already exists -- nothing changed. Use set-hosts.sh / set-dashboard-password.sh to change it." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Can't use Docker as $(id -un). Run: sudo usermod -aG docker \$USER, then log out and back in." >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl not found (sudo apt-get install -y openssl)." >&2; exit 1; }

umask 077
tmp=$(mktemp "$ENV_FILE.XXXXXX")
trap 'rm -f "$tmp" "$tmp.next"' EXIT
cp .env.example "$tmp"

# Replace NAME=... (or append it). The value goes through the environment, not
# argv, so it never appears in a process list.
set_var() {
  NAME="$1" VALUE="$2" awk '
    BEGIN { n = ENVIRON["NAME"]; v = ENVIRON["VALUE"] }
    index($0, n "=") == 1 && !done { print n "=" v; done = 1; next }
    { print }
    END { if (!done) print n "=" v }
  ' "$tmp" > "$tmp.next"
  mv "$tmp.next" "$tmp"
}

set_var KIOSK_TOKEN "$(openssl rand -hex 32)"

read -rsp "Gemini API key (Enter to skip = rule-based alerts only): " gemini; echo
if [ -n "$gemini" ]; then
  set_var GEMINI_API_KEY "'$gemini'"
  set_var GEMINI_ENABLED true
else
  set_var GEMINI_ENABLED false
fi

read -rsp "ElevenLabs API key (Enter to skip = no kiosk voice): " eleven; echo
if [ -n "$eleven" ]; then
  set_var ELEVENLABS_API_KEY "'$eleven'"
  set_var ELEVENLABS_ENABLED true
else
  set_var ELEVENLABS_ENABLED false
fi
unset gemini eleven

chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
trap - EXIT

ENV_FILE="$ENV_FILE" bash deploy/set-hosts.sh "$ROOT"
bash deploy/set-dashboard-password.sh "$ENV_FILE"

echo
echo "Created $ENV_FILE (chmod 600). Variables set (values hidden):"
grep -E '^[A-Z0-9_]+=.' "$ENV_FILE" | cut -d= -f1 | paste -sd' '
echo
echo "Next: bash deploy/remote-deploy.sh"
echo "The laptop kiosk needs KIOSK_TOKEN in frontend-kiosk/.env.local -- read it on the server with:"
echo "  grep ^KIOSK_TOKEN= $ENV_FILE"
