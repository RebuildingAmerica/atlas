#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

# Each Python package's pyproject enforces a 100% coverage gate via
# --cov-fail-under, so a non-zero exit here means a regression.

cd "$ROOT_DIR/libs/discovery-engine"
uv run pytest

cd "$ROOT_DIR/scout"
uv run pytest

cd "$ROOT_DIR/api"
uv run pytest tests
