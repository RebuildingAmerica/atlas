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
readonly ENVIRONMENT="$(required_env ATLAS_PDS_ENVIRONMENT)"
readonly GCP_PROJECT="$(required_env ATLAS_PDS_GCP_PROJECT)"
readonly PDS_HOSTNAME="$(required_env ATLAS_PDS_HOSTNAME)"
readonly PDS_PUBLIC_URL="$(required_env ATLAS_PDS_PUBLIC_URL)"
readonly HOST_DATA_DIRECTORY="$(required_env ATLAS_PDS_DATA_DIRECTORY)"

metadata_get() {
  curl --fail --silent --show-error \
    --header "Metadata-Flavor: Google" \
    "$METADATA_BASE_URL/$1"
}

readonly ACCESS_TOKEN="$(metadata_get 'instance/service-accounts/default/token' | python3 -c 'import json, sys; print(json.load(sys.stdin)["access_token"])')"

read_secret() {
  local secret_name="$1"
  local value
  value="$(curl --fail --silent --show-error \
    --header "Authorization: Bearer $ACCESS_TOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/$GCP_PROJECT/secrets/$secret_name/versions/latest:access" \
    | python3 -c 'import base64, json, sys; sys.stdout.write(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode())')"

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

install -d -m 0750 "$DEPLOY_DIRECTORY" "$HOST_DATA_DIRECTORY" "$HOST_DATA_DIRECTORY/blocks"
cd "$DEPLOY_DIRECTORY"

readonly ADMIN_PASSWORD="$(read_secret "atlas-pds-${ENVIRONMENT}-admin-password")"
readonly JWT_SECRET="$(read_secret "atlas-pds-${ENVIRONMENT}-jwt-secret")"
readonly PLC_ROTATION_KEY="$(read_secret "atlas-pds-${ENVIRONMENT}-plc-rotation-key")"
INVITE_BROKER_SECRET="${ATLAS_PDS_INVITE_BROKER_SECRET:-}"
if [ -z "$INVITE_BROKER_SECRET" ]; then
  INVITE_BROKER_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
fi
if [[ "$INVITE_BROKER_SECRET" == *$'\n'* ]] || [[ "$INVITE_BROKER_SECRET" == *$'\r'* ]]; then
  echo "ATLAS_PDS_INVITE_BROKER_SECRET must be a single-line value." >&2
  exit 1
fi
readonly INVITE_BROKER_SECRET

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
mv "$temporary_environment_file" "$ENVIRONMENT_FILE"

docker compose --env-file pds.env -f compose.hosted.yaml config --quiet
docker compose --env-file pds.env -f compose.hosted.yaml up -d
docker compose --env-file pds.env -f compose.hosted.yaml up -d --force-recreate \
  atlas-pds-invite-broker \
  atlas-pds-edge
