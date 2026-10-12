#!/usr/bin/env bash
set -Eeuo pipefail

required_env() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "$value" ]; then
    echo "$name is required." >&2
    exit 1
  fi
  printf '%s' "$value"
}

readonly METADATA_BASE_URL="http://metadata.google.internal/computeMetadata/v1"
readonly DEPLOY_DIRECTORY="${ATLAS_PDS_DEPLOY_DIRECTORY:-/opt/atlas-pds}"
ENVIRONMENT="$(required_env ATLAS_PDS_ENVIRONMENT)"
GCP_PROJECT="$(required_env ATLAS_PDS_GCP_PROJECT)"
PDS_HOSTNAME="$(required_env ATLAS_PDS_HOSTNAME)"
PDS_PUBLIC_URL="$(required_env ATLAS_PDS_PUBLIC_URL)"
HOST_DATA_DIRECTORY="$(required_env ATLAS_PDS_DATA_DIRECTORY)"
readonly ENVIRONMENT GCP_PROJECT PDS_HOSTNAME PDS_PUBLIC_URL HOST_DATA_DIRECTORY

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != --broker-only ]; }; then
  echo 'Usage: vm-release.sh [--broker-only]' >&2
  exit 64
fi

metadata_get() {
  curl --fail --silent --show-error \
    --header "Metadata-Flavor: Google" \
    "$METADATA_BASE_URL/$1"
}

read_secret() {
  local secret_name="$1"
  local value
  if ! value="$(curl --fail --silent --show-error \
    --header "Authorization: Bearer $ACCESS_TOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/$GCP_PROJECT/secrets/$secret_name/versions/latest:access" \
    | python3 -c 'import base64, json, sys; sys.stdout.write(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode())')"; then
    echo "Secret $secret_name could not be read; no PDS configuration was changed." >&2
    return 1
  fi

  if [ -z "$value" ] || [[ "$value" == *$'\n'* ]] || [[ "$value" == *$'\r'* ]]; then
    echo "Secret $secret_name must be a non-empty single-line value." >&2
    exit 1
  fi
  printf '%s' "$value"
}

if ! findmnt --target "$HOST_DATA_DIRECTORY" >/dev/null; then
  echo "ATLAS_PDS_DATA_DIRECTORY must be a mounted persistent disk: $HOST_DATA_DIRECTORY" >&2
  exit 1
fi

if [ "${1:-}" = --broker-only ]; then
  # Broker changes must preserve the credentials that let existing people sign in.
  cd "$DEPLOY_DIRECTORY"
  python3 - pds.env <<'PY'
import os
import sys
from pathlib import Path

values = {}
for line in Path(sys.argv[1]).read_text().splitlines():
    if not line.strip() or line.startswith("#"):
        continue
    key, separator, value = line.partition("=")
    if not separator or key in values:
        raise SystemExit("Retained PDS configuration is invalid.")
    values[key] = value
for key in ("PDS_ADMIN_PASSWORD", "PDS_JWT_SECRET", "PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX"):
    if not values.get(key, "").strip("'\""):
        raise SystemExit("Retained PDS credentials are incomplete; no containers were changed.")
for key in ("ATLAS_PDS_PUBLIC_URL", "ATLAS_PDS_HOSTNAME", "ATLAS_PDS_DATA_DIRECTORY", "ATLAS_PDS_INVITE_BROKER_SECRET"):
    if not os.environ.get(key) or values.get(key) != os.environ[key]:
        raise SystemExit("Retained PDS configuration differs from the deployment inputs.")
PY
  docker compose --env-file pds.env -f compose.hosted.yaml config --quiet
  container_id="$(docker compose --env-file pds.env -f compose.hosted.yaml ps -q atlas-pds)"
  if [ -z "$container_id" ] || [ "$(docker inspect --format '{{.State.Health.Status}}' "$container_id")" != healthy ]; then
    echo 'Broker deployment requires a healthy existing PDS.' >&2
    exit 1
  fi
  docker compose --env-file pds.env -f compose.hosted.yaml up -d --no-deps --force-recreate \
    atlas-pds-invite-broker atlas-pds-edge
  exit 0
fi

ACCESS_TOKEN="$(metadata_get 'instance/service-accounts/default/token' | python3 -c 'import json, sys; token = json.load(sys.stdin)["access_token"]; assert isinstance(token, str) and token; sys.stdout.write(token)')"
readonly ACCESS_TOKEN
ADMIN_PASSWORD="$(read_secret "atlas-pds-${ENVIRONMENT}-admin-password")"
JWT_SECRET="$(read_secret "atlas-pds-${ENVIRONMENT}-jwt-secret")"
PLC_ROTATION_KEY="$(read_secret "atlas-pds-${ENVIRONMENT}-plc-rotation-key")"
readonly ADMIN_PASSWORD JWT_SECRET PLC_ROTATION_KEY
INVITE_BROKER_SECRET="${ATLAS_PDS_INVITE_BROKER_SECRET:-}"
if [ -z "$INVITE_BROKER_SECRET" ]; then
  INVITE_BROKER_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
fi
if [[ "$INVITE_BROKER_SECRET" == *$'\n'* ]] || [[ "$INVITE_BROKER_SECRET" == *$'\r'* ]]; then
  echo "ATLAS_PDS_INVITE_BROKER_SECRET must be a single-line value." >&2
  exit 1
fi
readonly INVITE_BROKER_SECRET

install -d -m 0750 "$DEPLOY_DIRECTORY" "$HOST_DATA_DIRECTORY" "$HOST_DATA_DIRECTORY/blocks"
cd "$DEPLOY_DIRECTORY"
umask 077
readonly ENVIRONMENT_FILE="pds.env"
temporary_environment_file="$(mktemp "${ENVIRONMENT_FILE}.XXXXXX")"
trap 'rm -f "$temporary_environment_file"' EXIT

cat >"$temporary_environment_file" <<EOF
ATLAS_PDS_PUBLIC_URL=$PDS_PUBLIC_URL
ATLAS_PDS_HOSTNAME=$PDS_HOSTNAME
ATLAS_PDS_DATA_DIRECTORY=$HOST_DATA_DIRECTORY
ATLAS_PDS_INVITE_BROKER_SECRET=$INVITE_BROKER_SECRET
PDS_ADMIN_PASSWORD=$ADMIN_PASSWORD
PDS_JWT_SECRET=$JWT_SECRET
PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX=$PLC_ROTATION_KEY
PDS_DID_PLC_URL=${PDS_DID_PLC_URL:-https://plc.directory}
PDS_DATA_DIRECTORY=/pds
PDS_BLOBSTORE_DISK_LOCATION=/pds/blocks
PDS_PORT=${PDS_PORT:-2583}
EOF
chmod 600 "$temporary_environment_file"
docker compose --env-file "$temporary_environment_file" -f compose.hosted.yaml config --quiet
mv "$temporary_environment_file" "$ENVIRONMENT_FILE"

docker compose --env-file pds.env -f compose.hosted.yaml config --quiet
docker compose --env-file pds.env -f compose.hosted.yaml up -d
docker compose --env-file pds.env -f compose.hosted.yaml up -d --force-recreate \
  atlas-pds-invite-broker \
  atlas-pds-edge
