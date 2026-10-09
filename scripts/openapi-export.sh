#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

: "${ATLAS_MULTI_USER:=false}"
export ATLAS_MULTI_USER

cd "$ROOT_DIR/api"
UV_LINK_MODE=copy uv run python -m atlas.platform.openapi
# The platform routes are left out of the public document and the published
# API reference; the platform admin gets its own.
UV_LINK_MODE=copy uv run python -m atlas.platform.http.platform_router

cd "$ROOT_DIR"
sh ./scripts/mintlify-sync-openapi.sh
