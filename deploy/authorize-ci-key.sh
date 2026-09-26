#!/usr/bin/env bash
# Authorizes the GitHub Actions deploy key on the server -- locked down so it
# can ONLY run deploy/remote-deploy.sh: no shell, no port/agent forwarding,
# and whatever command the client asks for is ignored. A leaked key can at
# worst redeploy the current branch.
#
#   Get-Content er-angel-deploy.pub | ssh root@<server> bash /opt/er-angel/deploy/authorize-ci-key.sh
#
# Re-running replaces the previous CI key.
set -euo pipefail

AUTH=/root/.ssh/authorized_keys
TAG=er-angel-github-actions

# One public key on stdin (CRLF/BOM from Windows tolerated).
key=$(tr -d '\r' | sed '1s/^\xEF\xBB\xBF//' | grep -E '^ssh-ed25519 [A-Za-z0-9+/=]+' | head -1 | awk '{print $1" "$2}')
[ -n "$key" ] || { echo "Expected one ssh-ed25519 PUBLIC key on stdin -- nothing changed." >&2; exit 1; }
if grep -qF "${key#ssh-ed25519 }" "$AUTH" && ! grep -F "${key#ssh-ed25519 }" "$AUTH" | grep -q "$TAG"; then
  echo "That key already has full access (it's not a separate deploy-only key) -- nothing changed." >&2
  exit 1
fi

tmp=$(mktemp "$AUTH.XXXXXX")
grep -v " $TAG\$" "$AUTH" > "$tmp" || true
echo "restrict,command=\"bash /opt/er-angel/deploy/remote-deploy.sh\" $key $TAG" >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$AUTH"

echo "Authorized deploy-only key $(ssh-keygen -lf <(echo "$key") | awk '{print $2}') (forced command: deploy/remote-deploy.sh)"
