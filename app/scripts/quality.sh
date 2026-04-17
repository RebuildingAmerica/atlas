#!/usr/bin/env sh
set -eu

APP_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

cd "$APP_DIR"
pnpm run typecheck
pnpm run lint
pnpm run format:check
