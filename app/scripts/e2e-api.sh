#!/usr/bin/env sh
set -eu

APP_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

cd "$APP_DIR/.."
pnpm run e2e:api
