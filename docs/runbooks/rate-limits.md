# Anonymous API Rate Limits Runbook

Atlas rate limits unauthenticated public API traffic so a wrapper, crawler, or
misconfigured integration cannot make the public directory slower or less
trustworthy for people using the product directly.

## Current Limits

Hosted anonymous defaults are per client:

| Bucket                          | Limit | Window   |
| ------------------------------- | ----: | -------- |
| Public reads (`GET`, `HEAD`)    |    30 | 1 minute |
| Public writes                   |    10 | 1 minute |
| Total anonymous public requests |   120 | 1 hour   |
| Credential-present pre-auth     |    60 | 1 minute |
| Credential-present sustained    |   600 | 1 hour   |
| Cloudflare origin backstop      |   300 | 1 minute |

Credentialed browser sessions, trusted app-to-API requests, valid API keys, and
valid OAuth JWTs do not spend anonymous buckets after they are verified.
Requests that include `Authorization` or `X-API-Key` first spend the
credential-present pre-auth buckets so forged credentials cannot force repeated
API key introspection or JWT verification. Invalid or missing credentials are
then treated as anonymous traffic.

## Enforcement Layers

1. **Cloudflare edge** protects the canonical API domain before traffic reaches
   Cloud Run. Bootstrap installs rate-limit rules in the `http_ratelimit` phase
   and signed origin identity headers in the `http_request_late_transform`
   phase.
2. **App proxy** protects public `/api/*`, `/openapi.json`, and `/mcp` traffic
   that reaches the app server before it forwards to the API. Credential headers
   alone do not bypass this layer; only a real browser session can.
3. **API middleware** protects direct API-origin traffic and keeps the same
   anonymous and credential-present buckets available when Cloudflare or the app
   proxy is bypassed.

The API only trusts `X-Atlas-Client-IP` when it is paired with a matching
`X-Atlas-Proxy-Secret`. The app proxy signs that header with
`ATLAS_AUTH_INTERNAL_SECRET`; Cloudflare signs it with
`ATLAS_EDGE_ORIGIN_SECRET`. Hosted API deployments keep
`ATLAS_TRUST_UNSIGNED_FORWARD_HEADERS=false` so raw `X-Forwarded-For` cannot be
used to change a direct request's rate-limit identity.

The API and app return `429` with `Retry-After`, `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, and `X-RateLimit-Reset` when they block. Cloudflare
edge blocks return JSON `{"detail":"Too many requests."}`; Cloudflare may not
include the same `X-RateLimit-*` headers.

## Enable Hosted Edge Protection

Run the canonical domain phase first. It intentionally creates a DNS-only CNAME
so Cloud Run can finish certificate provisioning before Cloudflare is proxied.

```bash
pnpm bootstrap --api-domain
pnpm bootstrap --api-edge
```

For staging:

```bash
pnpm bootstrap --api-domain --target staging
pnpm bootstrap --api-edge --target staging
```

Use doctor mode for a read-only check:

```bash
pnpm bootstrap --api-edge --doctor
pnpm bootstrap --api-edge --doctor --target staging
```

The Cloudflare token needs DNS edit access and WAF edit access for the
`rebuildingus.org` zone, plus transform rule/ruleset permissions so bootstrap
can install the origin identity header rule.

## Verify After Deploy

Run the normal hosted smoke suite:

```bash
cd app
ATLAS_HOSTED_PUBLIC_URL=https://atlas.rebuildingus.org \
ATLAS_HOSTED_API_URL=https://atlas-api.rebuildingus.org \
pnpm run test:hosted-smoke
```

To intentionally exercise the anonymous limit, opt in:

```bash
cd app
ATLAS_HOSTED_EXPECT_RATE_LIMIT=true \
ATLAS_HOSTED_EXPECT_EDGE=true \
ATLAS_HOSTED_PUBLIC_URL=https://atlas.rebuildingus.org \
ATLAS_HOSTED_API_URL=https://atlas-api.rebuildingus.org \
pnpm run test:hosted-smoke
```

Manual probes:

```bash
curl -i https://atlas-api.rebuildingus.org/health
curl -i "https://atlas-api.rebuildingus.org/api/issue-areas?limit=1"
```

## Operator Signals

Look for structured log events named `anonymous_rate_limited` and
`invalid_credential_attempt`.

Important fields:

- `layer`: `api` or `app-proxy`
- `bucket`: `read-minute`, `write-minute`, `total-hour`, `credential-minute`, or
  `credential-hour`; present on `anonymous_rate_limited`
- `credential_kind`: `api_key`, `bearer`, `authorization`, or `multiple`;
  present on `invalid_credential_attempt`
- `method`
- `path_group`
- `retry_after_seconds`
- `client_key_hash`

Logs intentionally use a hash of the client key, not the raw client IP.
`invalid_credential_attempt` intentionally avoids the raw credential value, so
operators can alert on forged credential pressure without collecting secrets.

Cloudflare rule descriptions:

- `Atlas anonymous API reads`
- `Atlas anonymous API writes`
- `Atlas anonymous sustained API traffic`
- `Atlas credentialed API pre-auth traffic`
- `Atlas credentialed sustained API pre-auth traffic`
- `Atlas API origin abuse backstop`
- `Atlas API origin identity headers`

## Incident Response

If public API traffic spikes:

1. Confirm whether blocks are from Cloudflare, the app proxy, or the API.
2. Check `path_group` and `bucket` to identify the traffic shape.
3. If it is a legitimate integration, ask the caller to use an API key or OAuth.
4. If it is abusive unauthenticated traffic, keep the anonymous limits in place
   and consider lowering Cloudflare thresholds temporarily.
5. If real public users are blocked, prefer raising the specific bucket over
   disabling all anonymous limits.

Emergency disable switches:

- Set `ATLAS_ANON_RATE_LIMIT_ENABLED=false` on the app/API runtime to disable
  in-process anonymous limiting.
- Disable the Cloudflare WAF rules by description for edge-only rollback.

Re-enable the protection after the incident and run hosted smoke checks again.

## Changing Limits

When changing anonymous limits:

1. Update runtime environment variables.
2. Update Cloudflare desired rules in `scripts/bootstrap/phases/api-edge.ts`.
3. Run `pnpm bootstrap --api-edge` for each hosted target.
4. Update `docs/standards/api-conventions.md`, this runbook, and Mintlify API
   docs.
5. Run the focused API and app tests that cover anonymous limiting.
