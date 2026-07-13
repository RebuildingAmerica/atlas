# Atlas PDS service

Atlas runs the upstream Bluesky PDS image as an isolated monorepo service. The
PDS owns ATProto repositories, handles, DIDs, sessions, and blobs. Atlas only
receives verified public DID, handle, and PDS URL data through its normal
ATProto OAuth flow.

## Operations

Set the PDS variables from `pds.env.example` in the deployment secret store.
`PDS_JWT_SECRET`, `PDS_ADMIN_PASSWORD`, and
`PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX` must be distinct long random values.
Keep the `atlas-pds-data` volume in the backup plan and test restore against an
isolated environment before rotating the PLC key.

The service health endpoint is `GET /xrpc/_health`. Caddy terminates TLS for
`ATLAS_PDS_HOSTNAME` and sends traffic only to `atlas-pds:2583`.

## Local validation

Run `pnpm run compose:validate` to validate the manifest, then start the PDS
with `docker compose --env-file .env.example up atlas-pds`. Do not use sample
secrets outside a local machine.
