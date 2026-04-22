#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SOURCE_PATH="$ROOT_DIR/openapi/atlas.openapi.json"
TARGET_DIR="$ROOT_DIR/mintlify/openapi"
TARGET_PATH="$TARGET_DIR/atlas.openapi.json"

mkdir -p "$TARGET_DIR"
cp "$SOURCE_PATH" "$TARGET_PATH"

printf '%s\n' "$TARGET_PATH"
