# Atlas PDS service

Atlas runs the upstream Bluesky PDS image as an isolated monorepo service. The
PDS owns ATProto repositories, handles, DIDs, sessions, and blobs. Atlas only
receives verified public DID, handle, and PDS URL data through its normal
ATProto OAuth flow.

## Operations

Set the PDS variables from `pds.env.example` in the deployment secret store.
`PDS_JWT_SECRET`, `PDS_ADMIN_PASSWORD`, and
`PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX` must be distinct long random values.
Back up the mounted PDS data directory with the bundled host operation:

```sh
sudo env \
  ATLAS_PDS_ENVIRONMENT=staging \
  ATLAS_PDS_DATA_DIRECTORY=/var/lib/atlas-pds \
  ATLAS_PDS_DEPLOY_DIRECTORY=/opt/atlas-pds \
  ATLAS_PDS_BACKUP_URI=gs://atlas-pds-backups/staging/ \
  /opt/atlas-pds/vm-backup.sh backup
```

Restore only into an isolated host or a declared recovery window. The script
requires `ATLAS_PDS_RESTORE_CONFIRM=restore-$ATLAS_PDS_ENVIRONMENT`, stops the
Compose service, moves existing mounted-directory contents into a timestamped
`.restore-replaced-*` directory, extracts the archive, and restarts the PDS.
Test restore before rotating the PLC key.

The service health endpoint is `GET /xrpc/_health`. Caddy terminates TLS for
`ATLAS_PDS_HOSTNAME` and sends traffic only to `atlas-pds:2583`.

## Local validation

Run `pnpm run compose:validate` to validate the manifest, then start the PDS
with `docker compose --env-file .env.example up atlas-pds`. Do not use sample
secrets outside a local machine.
