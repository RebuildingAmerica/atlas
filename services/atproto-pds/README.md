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
`ATLAS_PDS_HOSTNAME`, sends normal PDS traffic to `atlas-pds:2583`, and sends
`POST /_atlas/pds/invites` to the private invite broker. The broker accepts only
the deployment-provided bearer secret, mints one-use invite codes with the local
PDS admin password, and never exposes the admin password to the Atlas app.

The hosted `doctor` runs `vm-check.sh` through the existing deployment identity.
It inspects bounded root-only configuration files in current and previous Atlas
directories, PDS containers attached to the same data disk, and literal Atlas
assignments in instance startup metadata. The report contains credential
presence and validation results, never secret values. Previous containers cannot
qualify as the current healthy PDS. It neither executes startup code nor changes
files, containers, permissions, or billing. Secret Manager's categorized errors
distinguish missing access from `BILLING_DISABLED` so recovery of existing
sign-in identities does not lead to unnecessary grants or credential rotation.

The data backup operation above does not archive `/opt/atlas-pds/pds.env`. Keep
the original credentials in the deployment secret store; a data archive alone
does not establish that the PDS's sign-in configuration can be recovered.

## Local validation

Run `pnpm run compose:validate` to validate the manifest, then start the PDS
with `docker compose --env-file .env.example up atlas-pds`. Do not use sample
secrets outside a local machine.
