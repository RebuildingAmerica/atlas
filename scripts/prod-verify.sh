#!/bin/sh
set -eu

pnpm exec turbo run \
  '//#python:test' \
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
