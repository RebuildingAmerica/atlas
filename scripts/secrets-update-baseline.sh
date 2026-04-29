#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"
uv --project api run --extra dev detect-secrets scan \
  --force-use-all-plugins \
  --exclude-files '(^|/)(pnpm-lock\.yaml|uv\.lock)$' \
  $(git ls-files) > .secrets.baseline
