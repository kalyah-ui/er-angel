#!/usr/bin/env bash
# Server side of a deploy: pull the branch the server is on, rebuild, reload
# Caddy, and wait for https://<SITE_ADDRESS>/api/health. On failure, prints
# the recent backend/web logs and exits non-zero.
#
# Run by scripts/deploy.ps1 (over SSH) and by GitHub Actions, whose key is
# locked to this script (see deploy/authorize-ci-key.sh). Takes no arguments
# from callers; --pulled is only used internally.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

if [ "${1:-}" != "--pulled" ]; then
  # One deploy at a time (laptop + GitHub Actions could overlap). Taken once
  # here; the open, locked fd 9 is inherited by the exec below.
  exec 9>/tmp/er-angel-deploy.lock
  flock -w 600 9 || { echo "DEPLOY FAILED: another deploy has been running for 10 min" >&2; exit 1; }

  branch=$(git branch --show-current)
  before=$(git rev-parse --short HEAD)
  git fetch -q origin "$branch"
  git merge -q --ff-only "origin/$branch" || { echo "DEPLOY FAILED: can't fast-forward $branch (local changes on the server?)" >&2; exit 1; }
  echo "==> $branch: $before -> $(git rev-parse --short HEAD)"
  # Continue with the version of this script that was just pulled.
  exec bash "$0" --pulled
fi

echo "==> Building and starting containers"
docker compose up -d --build --remove-orphans 2>&1 | grep -vE '^ *#|^$' | grep -E 'Built|Recreated|Started|Healthy|Running|ERROR|error' || true

# Picks up Caddyfile changes even when the container wasn't recreated (graceful, no downtime).
echo "==> Reloading Caddy config"
docker compose exec -T web caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | grep -iE 'error' || true

site=$(grep -E '^SITE_ADDRESS=' .env | cut -d= -f2- | tr -d "'\"")
echo "==> Waiting for https://$site/api/health"
for _ in $(seq 1 45); do
  if curl -fsS --max-time 5 "https://$site/api/health" 2>/dev/null | grep -q '"ok":true'; then
    docker image prune -f >/dev/null 2>&1 || true # old image layers from previous builds
    echo "DEPLOY OK: $(git branch --show-current) @ $(git log --oneline -1)"
    exit 0
  fi
  sleep 2
done

echo "DEPLOY FAILED: https://$site/api/health not ok after 90s" >&2
docker compose ps
echo "--- last backend logs"; docker compose logs --no-color --tail 60 backend
echo "--- last web (Caddy) logs"; docker compose logs --no-color --tail 20 web
exit 1
