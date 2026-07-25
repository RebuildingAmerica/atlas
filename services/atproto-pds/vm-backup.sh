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

usage() {
  cat >&2 <<'EOF'
Usage:
  vm-backup.sh backup
  vm-backup.sh restore

Required environment:
  ATLAS_PDS_ENVIRONMENT      staging or production environment label
  ATLAS_PDS_DATA_DIRECTORY   mounted persistent PDS data directory
  ATLAS_PDS_DEPLOY_DIRECTORY directory containing compose.hosted.yaml and pds.env
  ATLAS_PDS_BACKUP_URI       gs:// bucket prefix or local archive path

Restore additionally requires:
  ATLAS_PDS_RESTORE_CONFIRM=restore-$ATLAS_PDS_ENVIRONMENT
EOF
}

readonly COMMAND="${1:-}"
if [ "$COMMAND" != "backup" ] && [ "$COMMAND" != "restore" ]; then
  usage
  exit 64
fi

readonly ENVIRONMENT="$(required_env ATLAS_PDS_ENVIRONMENT)"
readonly DATA_DIRECTORY="$(required_env ATLAS_PDS_DATA_DIRECTORY)"
readonly DEPLOY_DIRECTORY="$(required_env ATLAS_PDS_DEPLOY_DIRECTORY)"
readonly BACKUP_URI="$(required_env ATLAS_PDS_BACKUP_URI)"
readonly COMPOSE_FILE="$DEPLOY_DIRECTORY/compose.hosted.yaml"
readonly COMPOSE_ENV_FILE="$DEPLOY_DIRECTORY/pds.env"

if ! findmnt --target "$DATA_DIRECTORY" >/dev/null; then
  echo "ATLAS_PDS_DATA_DIRECTORY must be a mounted persistent disk: $DATA_DIRECTORY" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ] || [ ! -f "$COMPOSE_ENV_FILE" ]; then
  echo "PDS deploy directory must contain compose.hosted.yaml and pds.env: $DEPLOY_DIRECTORY" >&2
  exit 1
fi

copy_to_uri() {
  local source="$1"
  local destination="$2"

  if [[ "$destination" == gs://* ]]; then
    gcloud storage cp "$source" "$destination"
    return
  fi

  install -d -m 0750 "$(dirname "$destination")"
  cp "$source" "$destination"
}

copy_from_uri() {
  local source="$1"
  local destination="$2"

  if [[ "$source" == gs://* ]]; then
    gcloud storage cp "$source" "$destination"
    return
  fi

  cp "$source" "$destination"
}

backup_destination() {
  local timestamp
  timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  local archive_name="atlas-pds-${ENVIRONMENT}-${timestamp}.tar.gz"

  case "$BACKUP_URI" in
    */) printf '%s%s' "$BACKUP_URI" "$archive_name" ;;
    *.tgz | *.tar.gz) printf '%s' "$BACKUP_URI" ;;
    *) printf '%s/%s' "$BACKUP_URI" "$archive_name" ;;
  esac
}

compose_down() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" down
}

compose_up() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" up -d
}

run_backup() {
  local destination
  destination="$(backup_destination)"
  workdir="$(mktemp -d)"
  local archive="$workdir/pds-data.tar.gz"
  local checksum="$archive.sha256"
  should_restart=0
  trap 'rm -rf "$workdir"; if [ "$should_restart" -eq 1 ]; then compose_up; fi' EXIT

  compose_down
  should_restart=1
  tar --one-file-system --xattrs --acls -C "$DATA_DIRECTORY" -czf "$archive" .
  sha256sum "$archive" >"$checksum"
  copy_to_uri "$archive" "$destination"
  copy_to_uri "$checksum" "$destination.sha256"
  echo "PDS backup written to $destination"
}

run_restore() {
  local confirmation="${ATLAS_PDS_RESTORE_CONFIRM:-}"
  if [ "$confirmation" != "restore-$ENVIRONMENT" ]; then
    echo "Set ATLAS_PDS_RESTORE_CONFIRM=restore-$ENVIRONMENT before restoring PDS data." >&2
    exit 1
  fi

  workdir="$(mktemp -d)"
  local archive="$workdir/pds-data.tar.gz"
  local replaced_directory="$DATA_DIRECTORY/.restore-replaced-$(date -u '+%Y%m%dT%H%M%SZ')"
  should_restart=0
  trap 'rm -rf "$workdir"; if [ "$should_restart" -eq 1 ]; then compose_up; fi' EXIT

  copy_from_uri "$BACKUP_URI" "$archive"
  tar -tzf "$archive" >/dev/null

  compose_down
  should_restart=1
  install -d -m 0750 "$DATA_DIRECTORY"
  install -d -m 0750 "$replaced_directory"
  find "$DATA_DIRECTORY" \
    -mindepth 1 \
    -maxdepth 1 \
    ! -name "$(basename "$replaced_directory")" \
    -exec mv -t "$replaced_directory" -- {} +
  tar --xattrs --acls -C "$DATA_DIRECTORY" -xzf "$archive"
  echo "PDS data restored from $BACKUP_URI; previous data moved to $replaced_directory"
}

case "$COMMAND" in
  backup) run_backup ;;
  restore) run_restore ;;
esac
