# Atlas-managed ATProto PDS

[Docs](../README.md) > [Deployment](./README.md) > Atlas-managed ATProto PDS

The PDS is a first-class stateful service in the Atlas monorepo, not a feature
of the Vercel app or Cloud Run API. It owns AT Protocol repositories, DIDs,
sessions, and blobs. Atlas receives only the verified DID, handle, and public
PDS URL; it never persists a PDS password or session token.

## Required hosted topology

The upstream PDS persists its supported state under `PDS_DATA_DIRECTORY` and
`PDS_BLOBSTORE_DISK_LOCATION`. A hosted PDS therefore needs a persistent runtime
with durable disk storage, a stable TLS hostname, and backups. Do not deploy it
to the existing Cloud Run lane: its filesystem is ephemeral and would make
account repositories and blobs unsafe across revision changes.

For each environment, provision all of the following before enabling managed
identity creation:

- a dedicated persistent host with Docker Compose and a disk mounted at
  `/var/lib/atlas-pds` (bound into the PDS container at `/pds`);
- a unique, Atlas-named first-level HTTPS hostname
  (`atlas-pds-staging.rebuildingus.org` for staging and
  `atlas-pds.rebuildingus.org` for production) pointed at that host. This keeps
  the PDS distinct from the organization-wide site while remaining eligible for
  Cloudflare Free automatic TLS;
- TLS termination for the PDS hostname and a reachable `GET /xrpc/_health`
  endpoint;
- durable backups of the entire mounted PDS data directory, created and restored
  with `services/atproto-pds/vm-backup.sh` against an isolated PDS host before
  promotion;
- GitHub deployment access that can update the persistent host through
  `./.github/actions/deploy-atlas-pds` without exposing PDS secrets in
  repository files.

The GitHub release workflows now deploy the PDS host after the reusable CI gate
identifies a PDS change. Staging deploys `atlas-pds-staging.rebuildingus.org`
only when PDS-relevant files change; production releases deploy
`atlas-pds.rebuildingus.org` before hosted smoke verification. The deploy
identity still needs Compute SSH through IAP, the target instance and zone in
environment secrets, and the production DNS name published before production can
be considered live-service-ready.

## Deployment configuration

Set these values only in the deployment secret store for each environment:

```env
ATLAS_PDS_PUBLIC_URL=https://pds.example.org
ATLAS_PDS_HOSTNAME=pds.example.org
PDS_ADMIN_PASSWORD=<unique-long-random-value>
PDS_JWT_SECRET=<unique-long-random-value>
PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX=<stable-64-hex-character-key>
PDS_DID_PLC_URL=https://plc.directory
PDS_DATA_DIRECTORY=/pds
PDS_BLOBSTORE_DISK_LOCATION=/pds/blocks
PDS_PORT=2583
```

`PDS_JWT_SECRET`, `PDS_ADMIN_PASSWORD`, and the PLC rotation key must remain
stable for the life of the PDS. Treat the rotation key and the `/pds` backup as
identity-recovery material. Rotating either without the upstream PDS recovery
procedure can strand managed accounts.

## Host release contract

`services/atproto-pds/vm-release.sh` is the only host-side command that writes
the runtime `pds.env` file. It requires the PDS VM's dedicated service account
to have `roles/secretmanager.secretAccessor` on exactly these environment-named
secrets:

- `atlas-pds-<environment>-admin-password`;
- `atlas-pds-<environment>-jwt-secret`;
- `atlas-pds-<environment>-plc-rotation-key`.

The script obtains an access token from the Compute metadata service, writes a
mode-600 environment file in the root-owned deployment directory, validates the
hosted Compose manifest, then starts it. Values must never be copied into the
repository, VM metadata, or workflow logs. The host data mount also holds
Caddy's certificate and configuration state, so the scheduled disk backup
captures all persistent runtime state.

Each GitHub environment that can release a PDS host must define:

- `GCP_PROJECT_ID`;
- `GCP_WORKLOAD_IDENTITY_PROVIDER`;
- `GCP_SERVICE_ACCOUNT`;
- `ATLAS_PDS_INSTANCE_NAME`;
- `ATLAS_PDS_INSTANCE_ZONE`.

The workflow passes only non-secret release coordinates to the VM. The VM reads
the PDS admin password, JWT secret, and PLC rotation key from Secret Manager
using its own service account, so GitHub never receives PDS runtime secrets.

The production app deploy has one narrower exception: the Vercel server
environment also needs `ATLAS_PDS_ADMIN_PASSWORD` so Atlas can create
Atlas-managed identities on the production PDS. The GitHub deploy service
account must therefore have `roles/secretmanager.secretAccessor` on exactly
`atlas-pds-production-admin-password`, not project-wide Secret Manager access.
Bootstrap grants that secret-level binding for `atlas-deploy@<project>`.

PDS hosts use the `atlas-pds` network tag. Their firewall configuration permits
ports 80 and 443 publicly, permits port 22 only from the IAP TCP forwarding
range, and explicitly denies direct public SSH. Operators must use
`gcloud compute ssh --tunnel-through-iap`; do not re-open TCP/22 to arbitrary
source addresses. The release identity needs the corresponding IAP tunnel and
Compute SSH permissions before it can update a host.

For a release, copy only `compose.hosted.yaml`, `Caddyfile`, `vm-backup.sh`, and
`vm-release.sh` to the root-owned deployment directory, then invoke:

```sh
sudo env \
  ATLAS_PDS_ENVIRONMENT=staging \
  ATLAS_PDS_GCP_PROJECT=rap-atlas-prod \
  ATLAS_PDS_HOSTNAME=atlas-pds-staging.rebuildingus.org \
  ATLAS_PDS_PUBLIC_URL=https://atlas-pds-staging.rebuildingus.org \
  ATLAS_PDS_DATA_DIRECTORY=/var/lib/atlas-pds \
  /opt/atlas-pds/vm-release.sh
```

Production uses the same command with its own VM, persistent disk, service
account, secret names, and public hostname.

## Backup and restore operation

`services/atproto-pds/vm-backup.sh` is the host-side backup and restore entry
point shipped with every PDS release bundle. It operates on the mounted
persistent data directory, not the source checkout, and refuses to run unless
`ATLAS_PDS_DATA_DIRECTORY` is an active mount. The backup command stops the PDS
Compose stack, archives the directory with extended attributes and ACLs, writes
a SHA-256 sidecar, copies both artifacts to `ATLAS_PDS_BACKUP_URI`, then starts
the stack again.

Use a `gs://` prefix for durable environment backups:

```sh
sudo env \
  ATLAS_PDS_ENVIRONMENT=staging \
  ATLAS_PDS_DATA_DIRECTORY=/var/lib/atlas-pds \
  ATLAS_PDS_DEPLOY_DIRECTORY=/opt/atlas-pds \
  ATLAS_PDS_BACKUP_URI=gs://atlas-pds-backups/staging/ \
  /opt/atlas-pds/vm-backup.sh backup
```

The script also accepts a local `.tar.gz` path for isolated restore drills. A
restore is intentionally noisy and requires an explicit confirmation value:

```sh
sudo env \
  ATLAS_PDS_ENVIRONMENT=staging \
  ATLAS_PDS_DATA_DIRECTORY=/var/lib/atlas-pds \
  ATLAS_PDS_DEPLOY_DIRECTORY=/opt/atlas-pds \
  ATLAS_PDS_BACKUP_URI=gs://atlas-pds-backups/staging/atlas-pds-staging-20260714T000000Z.tar.gz \
  ATLAS_PDS_RESTORE_CONFIRM=restore-staging \
  /opt/atlas-pds/vm-backup.sh restore
```

Restore stops the Compose stack, validates that the archive is readable, keeps
the mounted data directory in place, moves its current contents to a timestamped
`.restore-replaced-*` directory, extracts the archive, and starts the PDS. Do
not run restore on the production host except during a declared recovery window.
Prove each production backup by restoring it to an isolated host and checking
`/xrpc/_health` before you treat the backup as launch evidence.

## Verification and release

The root monorepo release gate includes `pnpm run pds:test`, which validates the
PDS configuration, backup/restore, and reusable live health-probe contracts.
After a hosted PDS deploy, run:

```sh
ATLAS_PDS_PUBLIC_URL=https://pds.example.org \
  node scripts/deploy/pds-release.mjs health
```

The probe requires an HTTPS, credential-free origin and verifies that
`/xrpc/_health` returns successful JSON with the upstream PDS version. This is
necessary but not sufficient for a launch: staging and production must also
prove managed account creation, the OAuth callback, organization attachment,
delegation/revocation, and passkey-gated ATProto-first sign-in against the
actual public PDS.

The signed-in hosted identity proof uses `/api/e2e/hosted/identity` to create
run-scoped synthetic accounts and browser sessions without depending on an
operator's personal browser. The route returns 404 unless
`ATLAS_HOSTED_E2E_ENABLED=1` and `ATLAS_HOSTED_E2E_SECRET` matches the request
header. Production must also set `ATLAS_HOSTED_E2E_PRODUCTION_ENABLED=1`; keep
that variable reserved for release verification windows so the helper is not
generally available.
