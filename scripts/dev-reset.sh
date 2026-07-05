#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

remove_sqlite_db() {
  db_path="$1"
  rm -f \
    "$db_path" \
    "$db_path-shm" \
    "$db_path-wal" \
    "$db_path-journal"
}

remove_sqlite_db "api/atlas.db"
remove_sqlite_db "app/data/auth/atlas-auth.sqlite"

rm -f api/.coverage

rm -rf \
  .turbo \
  api/.mypy_cache \
  api/.pytest_cache \
  api/.ruff_cache \
  api/.turbo \
  app/.tanstack \
  app/.turbo \
  app/coverage \
  app/node_modules/.cache/e2e \
  app/node_modules/.nitro \
  app/node_modules/.vite \
  app/playwright-report \
  app/test-results \
  mintlify/.turbo

mkdir -p \
  app/data/auth \
  app/node_modules/.cache/e2e

sh ./scripts/portless-reset.sh

echo "[dev-reset] Local Atlas dev state cleared. Run pnpm dev to start fresh."
