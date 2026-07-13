#!/usr/bin/env bash
set -Eeuo pipefail

readonly PDS_DATA_DEVICE="/dev/disk/by-id/google-atlas-pds-data"
readonly PDS_DATA_DIRECTORY="/var/lib/atlas-pds"
readonly PDS_DEPLOY_DIRECTORY="/opt/atlas-pds"

until [ -e "$PDS_DATA_DEVICE" ]; do
  sleep 1
done

if ! blkid "$PDS_DATA_DEVICE" >/dev/null 2>&1; then
  mkfs.ext4 -F "$PDS_DATA_DEVICE"
fi

install -d -m 0750 "$PDS_DATA_DIRECTORY" "$PDS_DEPLOY_DIRECTORY"
disk_uuid="$(blkid -s UUID -o value "$PDS_DATA_DEVICE")"
if ! grep -q "UUID=$disk_uuid" /etc/fstab; then
  printf 'UUID=%s %s ext4 defaults,nofail 0 2\n' "$disk_uuid" "$PDS_DATA_DIRECTORY" >>/etc/fstab
fi
mountpoint -q "$PDS_DATA_DIRECTORY" || mount "$PDS_DATA_DIRECTORY"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --yes docker.io docker-compose-v2
systemctl enable --now docker.service
