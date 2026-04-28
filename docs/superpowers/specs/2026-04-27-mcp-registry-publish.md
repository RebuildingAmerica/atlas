# MCP Registry Publish — Atlas

Runbook for publishing and re-publishing Atlas to the official MCP Registry under the `org.rebuildingus.atlas/atlas` namespace.

## Identity

- **Server name:** `org.rebuildingus.atlas/atlas`. Reverse-DNS is taken from `atlas.rebuildingus.org` rather than the apex `rebuildingus.org` because the apex is hard-redirected (HTTP 307) to `www.rebuildingus.org` on the rap-website Vercel project, and the registry verifier doesn't follow redirects when fetching the publisher-auth file. Switching to the subdomain keeps the entire publisher-auth surface under the Atlas Vercel project we already control.
- **Publisher auth method:** HTTP-based domain proof per the MCP Registry authentication spec. The public key is declared at `https://atlas.rebuildingus.org/.well-known/mcp-registry-auth`, served by Vite from `app/public/.well-known/`. The matching Ed25519 private key lives in 1Password under entry **"Atlas — MCP registry publisher key"**.
- **Why HTTP not DNS or GitHub:**
  - GitHub auth would force the namespace `io.github.rebuildingamerica/atlas`, which reads as a GitHub identity rather than the product brand.
  - DNS auth requires waiting for record propagation on every key rotation; HTTP auth lets us roll keys instantly by editing one env var and redeploying.
  - HTTP follows the same pattern as the existing `/.well-known/oauth-protected-resource` static asset — fewer moving pieces.

## How the well-known file gets there

The public key is **not** committed. `app/scripts/gen-well-known.mjs` reads `MCP_REGISTRY_AUTH_PUBKEY` (base64-encoded Ed25519 public key) and writes `app/public/.well-known/mcp-registry-auth` containing:

```
v=MCPv1; k=ed25519; p=<base64-pubkey>
```

The Turbo task `@rebuildingamerica/atlas-app#gen:well-known` (defined in `app/turbo.json`) materializes the file, and the `build` task `dependsOn` it. Vite serves the rendered file as a static asset.

`MCP_REGISTRY_AUTH_PUBKEY` is required when running `pnpm build`. The script throws (no silent default) if the env var is missing — production builds fail loudly rather than ship a deploy without the publisher-auth file.

## First-time publish

1. **Generate the keypair** on a maintainer machine:
   ```bash
   openssl genpkey -algorithm ed25519 -out atlas-mcp-publisher.pem
   openssl pkey -in atlas-mcp-publisher.pem -pubout -outform DER \
     | openssl base64 -A
   ```
   The base64 output of the public key is what goes into `MCP_REGISTRY_AUTH_PUBKEY`.
2. **Stash the private key** in 1Password under "Atlas — MCP registry publisher key". Never commit it. Never paste it into chat. Treat it like a Stripe restricted key.
3. **Set the public key** in the production Vercel environment:
   ```bash
   cd app
   pnpm dlx vercel env add MCP_REGISTRY_AUTH_PUBKEY production
   ```
4. **Deploy app/** so the well-known file is served at `https://atlas.rebuildingus.org/.well-known/mcp-registry-auth`.
5. **Verify the deploy:**
   ```bash
   curl -sI https://atlas.rebuildingus.org/mcp                                  # 401 + WWW-Authenticate
   curl https://atlas.rebuildingus.org/.well-known/oauth-protected-resource     # 200 JSON
   curl https://atlas.rebuildingus.org/.well-known/mcp-registry-auth            # 200 with v=MCPv1; ...
   curl https://atlas.rebuildingus.org/api/auth/.well-known/openid-configuration  # 200 JSON
   ```
6. **Authenticate** with the registry from a machine that has the private key:
   ```bash
   brew install mcp-publisher
   mcp-publisher login http --domain atlas.rebuildingus.org \
     --private-key "$(op read 'op://Atlas/Atlas — MCP registry publisher key/private-key-hex')"
   ```
   (Substitute whatever 1Password CLI path you use for the private key.)
7. **Publish** the manifest:
   ```bash
   cd mcp
   mcp-publisher publish
   ```
   Expect: `✓ Successfully published — Server org.rebuildingus.atlas/atlas version 1.0.0`.
8. **Verify the listing:**
   ```bash
   curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=org.rebuildingus.atlas/atlas"
   ```
   The response should include a `servers[]` entry with `name=org.rebuildingus.atlas/atlas`, `version=1.0.0`, and `remotes[0].url=https://atlas.rebuildingus.org/mcp`.

## Version bump (re-publish)

1. Edit `mcp/server.json` and bump `version` (e.g., `1.0.0` → `1.1.0`).
2. Edit `description`/`title`/`headers[]` if the user-facing copy or auth surface changed.
3. Re-authenticate if more than ~24 hours have passed since the last login (registry JWTs are short-lived):
   ```bash
   mcp-publisher login http --domain atlas.rebuildingus.org --private-key <hex>
   ```
4. `cd mcp && mcp-publisher publish`.
5. Verify the new version is listed.

## Key rotation

1. Generate a new Ed25519 keypair (same procedure as first-time publish, step 1).
2. Update the public key in 1Password and in the Vercel `MCP_REGISTRY_AUTH_PUBKEY` env var.
3. Trigger a redeploy so the new `mcp-registry-auth` file is served. Confirm with `curl`.
4. Re-run `mcp-publisher login http` with the new private key — registry now binds your publisher identity to the new key.
5. Old key is invalid. The previous private key can be deleted from 1Password.

## What's intentionally out of scope

- **Write tools** (`create_entity_flag`, `create_source_flag`) are not exposed via MCP yet — only the 10 read-only tools from `AtlasDataService`. Add to `api/atlas/platform/mcp/server.py` and bump `mcp/server.json` to `1.1.0` when ready to ship writes.
- **Automated CI publishing** (GitHub Action that runs `mcp-publisher publish` on `mcp/server.json` version bumps) is a future improvement. Manual publish is fine until publish frequency makes it painful.
- **Aggregator registries** (Smithery, etc.) — official registry first; aggregators can pick us up from there.

## Related files

- `mcp/server.json` — registry manifest.
- `app/scripts/gen-well-known.mjs` — publisher-auth file generator.
- `app/public/.well-known/oauth-protected-resource` — RFC 9728 static metadata.
- `api/atlas/platform/mcp/server.py` — FastMCP server + read-tool registrations.
- `api/atlas/platform/mcp/auth_middleware.py` — Bearer JWT auth + RFC 6750 §3 challenge.
- `app/src/routes/mcp.ts` + `app/src/domains/access/server/mcp-proxy.ts` — apex `/mcp` proxy with streaming pass-through.
