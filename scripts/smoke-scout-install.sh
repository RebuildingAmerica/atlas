#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/atlas-scout-install.XXXXXX")

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="$TMP_DIR/venv"
HOME_DIR="$TMP_DIR/home"

"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip >/dev/null
"$VENV_DIR/bin/python" -m pip install \
  "$ROOT_DIR/libs/shared" \
  "$ROOT_DIR/libs/discovery-engine" \
  "$ROOT_DIR/scout" >/dev/null

SCOUT="$VENV_DIR/bin/scout"
mkdir -p "$HOME_DIR"

"$SCOUT" --help >/dev/null
"$SCOUT" search-key --help >/dev/null
"$SCOUT" worker --help >/dev/null

HOME="$HOME_DIR" "$SCOUT" search-key set --value smoke-search-key >/dev/null
HOME="$HOME_DIR" "$SCOUT" search-key status | grep -q "Search key configured"

KEY_FILE="$HOME_DIR/Library/Application Support/atlas-scout/search-key.json"
KEY_MODE=$("$VENV_DIR/bin/python" - "$KEY_FILE" <<'PY'
import os
import sys

print(oct(os.stat(sys.argv[1]).st_mode & 0o777)[2:])
PY
)
if [ "$KEY_MODE" != "600" ]; then
  echo "Expected search key permissions 600, got $KEY_MODE" >&2
  exit 1
fi

HOME="$HOME_DIR" "$SCOUT" search-key delete | grep -q "Search key deleted"
HOME="$HOME_DIR" "$SCOUT" worker status | grep -q "Scout worker"

if HOME="$HOME_DIR" "$SCOUT" worker start >"$TMP_DIR/worker-start.out" 2>&1; then
  echo "Expected worker start without login to fail" >&2
  exit 1
fi
grep -q 'Log in with `scout login`' "$TMP_DIR/worker-start.out"

echo "Scout install smoke passed."
