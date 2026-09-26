#!/usr/bin/env bash
# Restore the ER Angel database from an Object Storage backup (on the server).
#
#   bash /opt/er-angel/deploy/restore-db.sh           # newest backup
#   bash /opt/er-angel/deploy/restore-db.sh <key>     # a specific one
#   bash /opt/er-angel/deploy/restore-db.sh --list    # show backups
#
# The backup is downloaded and integrity-checked BEFORE anything is touched.
# The current database is kept as waitwatch.db.before-restore-<time>.
set -euo pipefail
cd "$(dirname "$0")/.."

WHICH="${1:-latest}"
# One-off containers from the backend image, sharing its data volume and .env.
run() { docker compose run --rm --no-deps -T backend "$@"; }

if [ "$WHICH" = "--list" ]; then
  run node scripts/restore-db.js --list
  exit 0
fi

echo "1/4 Downloading and verifying backup: $WHICH"
run node scripts/restore-db.js "$WHICH" /app/data/restore-candidate.db

echo "2/4 Stopping backend"
docker compose stop backend

stamp=$(date -u +%Y%m%dT%H%M%SZ)
echo "3/4 Swapping in the backup (current db kept as waitwatch.db.before-restore-$stamp)"
run sh -c "mv /app/data/waitwatch.db /app/data/waitwatch.db.before-restore-$stamp && mv /app/data/restore-candidate.db /app/data/waitwatch.db"

echo "4/4 Starting backend"
docker compose up -d backend
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q backend)")" = "healthy" ] && { echo "Restore complete -- backend healthy."; exit 0; }
  sleep 2
done
echo "Backend didn't report healthy in 60s -- check: docker compose logs backend" >&2
exit 1
