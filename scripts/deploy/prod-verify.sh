#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"

cd "$ROOT_DIR"

pnpm exec turbo run \
  test \
  contract:test \
  compose:validate \
  pds:test \
  secrets:scan \
  openapi:lint \
  typecheck \
  lint \
  format:check \
  test:acceptance \
  build

node --import tsx ./app/scripts/check-bundle-budget.ts
