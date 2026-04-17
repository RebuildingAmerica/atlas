#!/usr/bin/env sh
set -eu

APP_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

cd "$APP_DIR/../api"
uv run atlas-export-openapi
