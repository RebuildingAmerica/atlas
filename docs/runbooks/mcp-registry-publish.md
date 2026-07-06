# MCP Registry — Publish Runbook

Operational steps for publishing, re-publishing, rotating keys, and unpublishing
Atlas in the official MCP Registry under the `org.rebuildingus.atlas/atlas`
namespace.

For the rationale behind these choices (DNS over HTTP/GitHub, namespace, history
of the 2026-04-29 unpublish), see
`docs/superpowers/specs/2026-04-27-mcp-registry-publish.md`.

## First-time setup (or rotate the publisher key)

The canonical path is the bootstrap interactive flow — it generates the Ed25519
keypair, persists it under `~/.config/mcp-publisher/atlas.{key,pub}`, walks
through Cloudflare TXT setup (API or dashboard), waits for propagation, and
verifies `mcp-publisher login` succeeds:

```bash
pnpm mcp:setup
# or as part of full bootstrap:  pnpm bootstrap
# read-only check at any time:    pnpm mcp:setup --doctor
```

The flow handles both first-time setup and key rotation (it detects an existing
keypair and prompts).

## Prepare a new version

1. Confirm the intended version is unique. Registry versions are immutable:
   ```bash
   curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=org.rebuildingus.atlas&include_deleted=true"
   ```
   Use `0.1.0` for the first prepared relist unless that exact version already
   exists; then bump to the next patch version.
2. Edit `mcp/server.json` when the user-facing registry surface changes:
   `title`, `description`, `version`, or `remotes[]`. Do not add manual
   authorization headers for Atlas OAuth; compliant clients discover auth from
   the MCP/OAuth challenge metadata.
3. Validate the manifest:
   ```bash
   cd mcp && mcp-publisher validate
   ```
4. Verify the public connection path before publishing:
   ```bash
   dig +short rebuildingus.org TXT @1.1.1.1 | grep MCPv1
   curl -i https://atlas.rebuildingus.org/.well-known/oauth-protected-resource/mcp
   curl -i -X POST https://atlas.rebuildingus.org/mcp \
     -H 'Accept: application/json, text/event-stream' \
     -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"registry-preflight","version":"0.0.0"}}}'
   ```
   The protected-resource metadata must describe
   `https://atlas.rebuildingus.org/mcp`, and the MCP request must reach Atlas
   and return a proper OAuth challenge rather than an HTTP redirect loop,
   insecure downgrade, host-header failure, or app 404.
5. Keep public docs in a prepared/not-active state until the active registry
   query verifies the new listing.

## Publish a new version

Only publish after the preparation checks pass.

1. Authenticate and publish back-to-back. Login JWTs expire after ~5 minutes, so
   run them in the same shell session:
   ```bash
   mcp-publisher login dns --domain rebuildingus.org \
     --private-key "$(cat ~/.config/mcp-publisher/atlas.key)"
   cd mcp && mcp-publisher publish
   ```
2. Verify the active listing:
   ```bash
   curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=org.rebuildingus.atlas/atlas"
   ```
3. After the listing is active, update the public docs to remove
   prepared/not-active language.

## Soft-delete (unpublish) a version

The registry has no hard-delete. `status: "deleted"` hides an entry from default
listings while leaving it visible to aggregators with `?include_deleted=true`.

```bash
mcp-publisher login dns --domain rebuildingus.org \
  --private-key "$(cat ~/.config/mcp-publisher/atlas.key)"
mcp-publisher status --status deleted \
  --message "<reason>" \
  org.rebuildingus.atlas/atlas <version>
```

`--status deprecated` is the softer alternative — entry stays visible with a
deprecation marker. Use it when telling consumers to migrate, not when
retracting a release.

## Verify a publish from the consumer side

```bash
# Default search (excludes deleted entries)
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=org.rebuildingus.atlas"

# Include deleted entries
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=org.rebuildingus.atlas&include_deleted=true"
```

## Manual fallbacks (when bootstrap can't be used)

If `pnpm mcp:setup` is unavailable (CI, fresh clone before install, debugging),
the equivalent manual steps:

```bash
# 1. Generate + persist keypair
pnpm mcp:gen-publisher-key --force

# 2. Update the Cloudflare TXT record on rebuildingus.org apex (TTL 60).
#    Either the dashboard, or with a token that has Zone:DNS:Edit:
PUB_BASE64=$(cat ~/.config/mcp-publisher/atlas.pub)
ZONE_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=rebuildingus.org" | jq -r '.result[0].id')
RECORD_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=TXT&name=rebuildingus.org" \
  | jq -r '.result[] | select(.content | startswith("v=MCPv1;")) | .id')
curl -X PATCH -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  -d "{\"content\":\"v=MCPv1; k=ed25519; p=$PUB_BASE64\",\"ttl\":60}" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID"

# 3. Wait one TTL (60s) and verify
dig +short rebuildingus.org TXT @1.1.1.1 | grep MCPv1

# 4. Confirm auth
mcp-publisher login dns --domain rebuildingus.org \
  --private-key "$(cat ~/.config/mcp-publisher/atlas.key)"
```

## Related files

- `mcp/server.json` — manifest published to the registry.
- `scripts/bootstrap/phases/mcp-registry.ts` — interactive setup phase
  (`pnpm mcp:setup`).
- `scripts/mcp-gen-publisher-key.mjs` — keypair generator
  (`pnpm mcp:gen-publisher-key`).
- `~/.config/mcp-publisher/atlas.key` — private key (outside repo, `chmod 600`).
- `~/.config/mcp-publisher/atlas.pub` — public key (outside repo).
- `~/.config/mcp-publisher/cloudflare-token` — optional stashed Cloudflare API
  token (chmod 600); reused by `pnpm mcp:setup` for future rotations.
- Cloudflare zone `rebuildingus.org` — TXT record on apex carries the public
  key.
- `docs/superpowers/specs/2026-04-27-mcp-registry-publish.md` — design rationale
  and history.
