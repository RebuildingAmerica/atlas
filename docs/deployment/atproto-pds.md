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
- a unique HTTPS hostname (`pds-staging.rebuildingus.org` for staging and
  `pds.rebuildingus.org` for production) pointed at that host;
- TLS termination for the PDS hostname and a reachable `GET /xrpc/_health`
  endpoint;
- durable backups of the entire `/pds` directory, with a restore test against an
  isolated PDS host;
- GitHub deployment access that can update the persistent host without exposing
  PDS secrets in repository files.

The current Google project deploy identity is authorized for Cloud Run only. It
cannot provision or update a persistent PDS host. The PDS DNS names are also not
currently published. Until both are deliberately provisioned, managed identity
controls remain repository-complete but are not live-service-ready.

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

PDS hosts use the `atlas-pds` network tag. Their firewall configuration permits
ports 80 and 443 publicly, permits port 22 only from the IAP TCP forwarding
range, and explicitly denies direct public SSH. Operators must use
`gcloud compute ssh --tunnel-through-iap`; do not re-open TCP/22 to arbitrary
source addresses. The release identity needs the corresponding IAP tunnel and
Compute SSH permissions before it can update a host.

For a release, copy only `compose.hosted.yaml`, `Caddyfile`, and `vm-release.sh`
to the root-owned deployment directory, then invoke:

```sh
sudo env \
  ATLAS_PDS_ENVIRONMENT=staging \
  ATLAS_PDS_GCP_PROJECT=rap-atlas-prod \
  ATLAS_PDS_HOSTNAME=pds-staging.example.org \
  ATLAS_PDS_PUBLIC_URL=https://pds-staging.example.org \
  ATLAS_PDS_DATA_DIRECTORY=/var/lib/atlas-pds \
  /opt/atlas-pds/vm-release.sh
```

Production uses the same command with its own VM, persistent disk, service
account, secret names, and public hostname.

## Verification and release

The root monorepo release gate includes `pnpm run pds:test`, which validates the
PDS configuration contract and the reusable live health probe. After a hosted
PDS deploy, run:

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
