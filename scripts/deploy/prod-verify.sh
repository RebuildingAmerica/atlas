#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"

cd "$ROOT_DIR"

pnpm exec turbo run \
  '@rebuildingamerica/atlas-shared#test' \
  '@rebuildingamerica/atlas-discovery-engine#test' \
  '@rebuildingamerica/atlas-scout#test' \
  '@rebuildingamerica/atlas-api#test' \
  '//#contract:test' \
  '//#compose:validate' \
  '//#secrets:scan' \
  '@rebuildingamerica/atlas-app#api-client' \
  '@rebuildingamerica/atlas-app#openapi:lint' \
  '@rebuildingamerica/atlas-app#typecheck' \
  '@rebuildingamerica/atlas-app#lint' \
  '@rebuildingamerica/atlas-app#format:check' \
  '@rebuildingamerica/atlas-app#test' \
  '@rebuildingamerica/atlas-app#test:acceptance' \
  '@rebuildingamerica/atlas-app#build'

node --import tsx ./app/scripts/check-bundle-budget.ts
