# MCP Registry — Publish Runbook

Operational steps for publishing, re-publishing, rotating keys, and unpublishing Atlas in the official MCP Registry under the `org.rebuildingus.atlas/atlas` namespace.

For the rationale behind these choices (DNS over HTTP/GitHub, namespace, history of the 2026-04-29 unpublish), see `docs/superpowers/specs/2026-04-27-mcp-registry-publish.md`.

## Prerequisites

- `mcp-publisher` installed: `brew install mcp-publisher`
- Cloudflare DNS edit access for the `rebuildingus.org` zone
- Publisher keypair on disk at `~/.config/mcp-publisher/atlas.{key,pub}` (private key `chmod 600`, hex-encoded; public key base64-encoded). If the key is missing, follow **Rotate the publisher key** below — the registry rebinds publisher identity to whichever key currently sits in DNS.
- Login JWTs from the registry expire **after ~5 minutes**. Run `mcp-publisher login` and the next command back-to-back.

## Publish a new version

1. Bump `mcp/server.json#version` and edit `description`/`title`/`headers[]` if anything in the user-facing surface changed.
2. Validate the manifest: `cd mcp && mcp-publisher validate`.
3. Authenticate and publish back-to-back:
   ```bash
   mcp-publisher login dns --domain rebuildingus.org \
     --private-key "$(cat ~/.config/mcp-publisher/atlas.key)"
   cd mcp && mcp-publisher publish
   ```
4. Verify the listing:
   ```bash
   curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=org.rebuildingus.atlas/atlas"
   ```

## Soft-delete (unpublish) a version

The registry has no hard-delete. `status: "deleted"` hides an entry from default listings while leaving it visible to aggregators with `?include_deleted=true`.

```bash
mcp-publisher login dns --domain rebuildingus.org \
  --private-key "$(cat ~/.config/mcp-publisher/atlas.key)"
mcp-publisher status --status deleted \
  --message "<reason>" \
  org.rebuildingus.atlas/atlas <version>
```

`--status deprecated` is the softer alternative — entry stays visible with a deprecation marker. Use it when telling consumers to migrate, not when retracting a release.

## Rotate the publisher key

1. Generate the new keypair and write it to `~/.config/mcp-publisher/atlas.{key,pub}`:
   ```bash
   pnpm mcp:gen-publisher-key --force
   ```
   The script prints the new public key in TXT-record-ready form: `v=MCPv1; k=ed25519; p=<base64>`.

2. Update the Cloudflare TXT record on `rebuildingus.org` apex (Type `TXT`, Name `@`, TTL `60`) with the printed value. Via the dashboard, or via the API with a token that has `Zone:DNS:Edit`:
   ```bash
   PUB_BASE64=$(cat ~/.config/mcp-publisher/atlas.pub)
   ZONE_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     "https://api.cloudflare.com/client/v4/zones?name=rebuildingus.org" | jq -r '.result[0].id')
   RECORD_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=TXT&name=rebuildingus.org" \
     | jq -r '.result[] | select(.content | startswith("v=MCPv1;")) | .id')
   curl -X PATCH -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
     -d "{\"content\":\"v=MCPv1; k=ed25519; p=$PUB_BASE64\",\"ttl\":60}" \
     "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID"
   ```

3. Wait one TTL (60s) and verify:
   ```bash
   dig +short rebuildingus.org TXT @1.1.1.1 | grep MCPv1
   ```

4. Re-authenticate to confirm:
   ```bash
   mcp-publisher login dns --domain rebuildingus.org \
     --private-key "$(cat ~/.config/mcp-publisher/atlas.key)"
   ```

## Verify a publish from the consumer side

```bash
# Default search (excludes deleted entries)
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=org.rebuildingus.atlas"

# Include deleted entries
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=org.rebuildingus.atlas&include_deleted=true"
```

## Related files

- `mcp/server.json` — manifest published to the registry.
- `scripts/mcp-gen-publisher-key.mjs` — keypair generator (`pnpm mcp:gen-publisher-key`).
- `~/.config/mcp-publisher/atlas.key` — private key (outside repo, `chmod 600`).
- `~/.config/mcp-publisher/atlas.pub` — public key (outside repo).
- Cloudflare zone `rebuildingus.org` — TXT record on apex carries the public key.
- `docs/superpowers/specs/2026-04-27-mcp-registry-publish.md` — design rationale and history.
