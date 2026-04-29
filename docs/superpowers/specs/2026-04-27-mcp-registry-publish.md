# MCP Registry Publish — Atlas

Design rationale and history for Atlas's listing in the official MCP Registry under the `org.rebuildingus.atlas/atlas` namespace. Operational steps live in `docs/runbooks/mcp-registry-publish.md`.

## History

- **2026-04-28** — `org.rebuildingus.atlas/atlas` v1.0.0 published using HTTP-based publisher proof, with the public key materialized at `https://atlas.rebuildingus.org/.well-known/mcp-registry-auth` from a Vercel env var via a Turbo build task.
- **2026-04-29** — v1.0.0 soft-deleted (status `deleted`) because it was published prematurely; the read/write tool surface had not stabilized. Publisher auth migrated from HTTP-based to DNS-based proof. The keypair generated for the original publish was lost (never persisted), so the migration also rotated to a fresh keypair stored at `~/.config/mcp-publisher/atlas.{key,pub}`. The next publish starts at `0.1.0`.

## Identity

- **Server name:** `org.rebuildingus.atlas/atlas`. The namespace is bound to ownership of `rebuildingus.org` and grants the entire `org.rebuildingus.*` prefix; the `atlas` segment scopes this manifest within that prefix.
- **Publisher auth method:** DNS-based domain proof. A TXT record on the `rebuildingus.org` apex declares the Ed25519 public key. The matching private key lives in `~/.config/mcp-publisher/atlas.key`.

## Why DNS over HTTP and GitHub

- **GitHub auth** would force the namespace `io.github.rebuildingamerica/atlas`, which reads as a GitHub identity rather than the product brand.
- **HTTP auth** (the original choice) requires a Vercel env var, a Turbo task, a build-time generator script, a `.gitignore` carve-out, and a redeploy on every key rotation. The original spec rejected DNS for "rotation latency," but Cloudflare TXT records with a 60s TTL rotate as fast as a Vercel redeploy without any of the build plumbing.
- **DNS auth** rotates by editing one row in Cloudflare. No code, no build pipeline, no env var. The full HTTP-side scaffolding (`MCP_REGISTRY_AUTH_PUBKEY`, `app/scripts/gen-well-known.mjs`, the `gen:well-known` Turbo task, the `.gitignore` carve-out) was removed in the 2026-04-29 migration.

## How DNS proof works

The MCP Registry verifier resolves a TXT record on the apex domain you control. The record value matches the legacy well-known file format:

```
rebuildingus.org. IN TXT "v=MCPv1; k=ed25519; p=<base64-pubkey>"
```

`mcp-publisher login dns` signs a challenge with the matching private key; the registry resolves the TXT record, compares the public key, and on success issues a JWT valid for ~5 minutes. (The previous version of this spec claimed JWTs last ~24 hours; that was wrong — verified empirically.)

## What's intentionally out of scope

- **Write tools** (`create_entity_flag`, `create_source_flag`) are not exposed via MCP yet — only the read-only tools from `AtlasDataService`. Add to `api/atlas/platform/mcp/server.py` and bump `mcp/server.json` when ready to ship writes.
- **Automated CI publishing** (GitHub Action that runs `mcp-publisher publish` on `mcp/server.json` version bumps) is a future improvement. Manual publish is fine until publish frequency makes it painful.
- **Aggregator registries** (Smithery, etc.) — official registry first; aggregators can pick us up from there.

## Related files

- `mcp/server.json` — registry manifest.
- `scripts/mcp-gen-publisher-key.mjs` — keypair generator (`pnpm mcp:gen-publisher-key`).
- `docs/runbooks/mcp-registry-publish.md` — operational steps (publish, rotate, soft-delete).
- `api/atlas/platform/mcp/server.py` — FastMCP server + read-tool registrations.
- `api/atlas/platform/mcp/auth_middleware.py` — Bearer JWT auth + RFC 6750 §3 challenge.
- `app/src/routes/mcp.ts` + `app/src/domains/access/server/mcp-proxy.ts` — apex `/mcp` proxy with streaming pass-through.
