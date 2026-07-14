# Milestone 12: Atlas-Managed PDS Foundation

**Status:** Staging PDS deploy and public health verified; signed-in hosted
managed-identity flow proof pending

## Objective

Offer Atlas-hosted ATProto identities without introducing a second identity
graph or persisting protocol credentials in Atlas application storage.

## Delivered

- [x] Runs the upstream PDS as an isolated Compose service with a persistent
      data volume, health check, and dedicated public edge host.
- [x] Validates `ATLAS_PDS_PUBLIC_URL` as a credential-free HTTPS public origin
      before the app uses it.
- [x] Creates managed accounts with the installed `@atproto/api` client and a
      request-local random password.
- [x] Discards the returned access and refresh tokens; only DID, current handle,
      and PDS URL pass to the existing Atlas identity-control API.
- [x] Presents “Use an Atlas identity” as the default account and organization
      path while retaining an explicit external-PDS OAuth connection path.
- [x] Covers the organization managed-identity browser path in local acceptance
      without storing credentials by using the explicit ATProto E2E harness.
- [x] Wires CI, staging deploy, and production release workflows through a
      reusable hosted PDS action so PDS changes can update the persistent host
      and prove public `/xrpc/_health` before hosted smoke verification.
- [x] Ships a host-side backup and restore operation with the PDS release
      bundle. The operation refuses non-mounted data directories, stops the
      Compose stack around archive/restore work, writes SHA-256 backup sidecars,
      and requires an explicit restore confirmation.

## Security boundary

The PDS admin password is deployment configuration, not an account password.
Atlas neither writes the generated account password nor PDS OAuth tokens to the
application database. The PDS adapter does not expose either value to the
browser or its callers.

## Remaining work

- Define the managed-account credential recovery and migration operation before
  advertising direct PDS credential access.
- Prove signed-in managed-account creation and the OAuth callback through the
  public staging PDS.
- Provision the corresponding production PDS host, DNS/TLS, deployment identity
  secrets, and prove the durable backup/restore operation against an isolated
  host.
- Complete production PDS health, creation, and callback proof.

## Hosted staging evidence

- 2026-07-14 staging run
  [`29364644020`](https://github.com/RebuildingAmerica/atlas/actions/runs/29364644020)
  completed successfully for `cf63aace0f22407ae0a1895555a84c6564998e3c`,
  including `deploy-pds` and `hosted-smoke`.
- The post-deploy PDS health probe passed with
  `ATLAS_PDS_PUBLIC_URL=https://atlas-pds-staging.rebuildingus.org node scripts/deploy/pds-release.mjs health`,
  reporting upstream version `0.4.5009`.
- Hosted smoke verified the public staging PDS health endpoint and public
  ATProto route metadata. It does not prove signed-in managed-account creation;
  that remains the next required staging check.
