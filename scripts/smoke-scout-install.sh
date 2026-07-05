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
KEYRING_BACKEND_DIR="$TMP_DIR/keyring-backend"

"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip >/dev/null
"$VENV_DIR/bin/python" -m pip install \
  "$ROOT_DIR/libs/shared" \
  "$ROOT_DIR/libs/discovery-engine" \
  "$ROOT_DIR/scout" >/dev/null

SCOUT="$VENV_DIR/bin/scout"
mkdir -p "$HOME_DIR" "$KEYRING_BACKEND_DIR"

cat >"$KEYRING_BACKEND_DIR/atlas_smoke_keyring.py" <<'PY'
import json
import os

from keyring.backend import KeyringBackend


class Keyring(KeyringBackend):
    priority = 1

    def _path(self):
        path = os.environ.get("ATLAS_SMOKE_KEYRING_FILE")
        if not path:
            raise RuntimeError("ATLAS_SMOKE_KEYRING_FILE is required.")
        return path

    def _load(self):
        path = self._path()
        if not os.path.exists(path):
            return {}
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)

    def _save(self, store):
        with open(self._path(), "w", encoding="utf-8") as handle:
            json.dump(store, handle, sort_keys=True)

    def set_password(self, servicename, username, password):
        store = self._load()
        store[f"{servicename}:{username}"] = password
        self._save(store)

    def get_password(self, servicename, username):
        return self._load().get(f"{servicename}:{username}")

    def delete_password(self, servicename, username):
        store = self._load()
        store.pop(f"{servicename}:{username}", None)
        self._save(store)
PY

run_scout() {
  PYTHONPATH="$KEYRING_BACKEND_DIR" \
    ATLAS_SMOKE_KEYRING_FILE="$TMP_DIR/keyring.json" \
    PYTHON_KEYRING_BACKEND="atlas_smoke_keyring.Keyring" \
    HOME="$HOME_DIR" \
    "$SCOUT" "$@"
}

"$SCOUT" --help >/dev/null
"$SCOUT" search-key --help >/dev/null
"$SCOUT" worker --help >/dev/null

KEY_FILE="$HOME_DIR/Library/Application Support/atlas-scout/search-key.json"
run_scout search-key set --value smoke-search-key >/dev/null
run_scout search-key status | grep -q "OS credential store"

if [ -e "$KEY_FILE" ]; then
  echo "Expected search key to avoid plaintext file storage." >&2
  exit 1
fi

run_scout search-key delete | grep -q "Search key deleted"
run_scout worker status | grep -q "Scout worker"

if run_scout worker start >"$TMP_DIR/worker-start.out" 2>&1; then
  echo "Expected worker start without login to fail" >&2
  exit 1
fi
grep -q 'Log in with `scout login`' "$TMP_DIR/worker-start.out"

echo "Scout install smoke passed."
