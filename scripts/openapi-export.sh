#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR/api"
uv run python -m atlas.platform.openapi

cd "$ROOT_DIR"
sh ./scripts/mintlify-sync-openapi.sh
