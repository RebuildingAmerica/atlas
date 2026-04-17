#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"
uv --project api run detect-secrets-hook --baseline .secrets.baseline $(git ls-files)
