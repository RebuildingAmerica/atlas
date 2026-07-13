# Milestone 12: Atlas-Managed PDS Foundation

**Status:** Repository-ready; hosted PDS provisioning required

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

## Security boundary

The PDS admin password is deployment configuration, not an account password.
Atlas neither writes the generated account password nor PDS OAuth tokens to the
application database. The PDS adapter does not expose either value to the
browser or its callers.

## Remaining work

- Define the managed-account credential recovery and migration operation before
  advertising direct PDS credential access.
- Provision the persistent staging and production PDS hosts, their DNS/TLS,
  deployment identity, and durable backup/restore operation.
- Complete staging and production PDS health, creation, and callback proof.
