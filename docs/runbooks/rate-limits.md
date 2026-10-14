# Anonymous API rate limits

Atlas limits anonymous traffic so search, source-linked profiles, and sign-in
remain usable when a crawler or integration sends too many requests. The public
web Worker proxies the intended API paths to the Cloudflare API Worker;
`atlas-api.rebuildingus.org` is the canonical API route. Neither route points to
Cloud Run.

| Bucket                          | Limit | Window   |
| ------------------------------- | ----: | -------- |
| Public reads (`GET`, `HEAD`)    |    30 | 1 minute |
| Public writes                   |    10 | 1 minute |
| Total anonymous public requests |   120 | 1 hour   |
| Credential-present pre-auth     |    60 | 1 minute |
| Credential-present sustained    |   600 | 1 hour   |

The app proxy and API middleware enforce their own limits. A request with
`Authorization` or `X-API-Key` spends the pre-auth bucket before the API
verifies the credential; a verified session or key then avoids the anonymous
bucket. Requests with both credential headers are invalid. The API trusts
`X-Atlas-Client-IP` only with a valid `X-Atlas-Proxy-Secret` signed using
`ATLAS_EDGE_ORIGIN_SECRET`; unsigned forwarding headers remain untrusted.

## Diagnose an incident

1. Check the production canary and the public `/health`, `/openapi.json`,
   search, and sign-in paths. Use Cloudflare Workers Observability on the web
   and API Workers to locate `anonymous_rate_limited` and
   `invalid_credential_attempt` events. Logs identify the layer, bucket, path
   group, and hashed client key without exposing the raw IP or credential.
2. Distinguish a Worker error or Free-plan quota exhaustion from an intentional
   `429`. Check the response's `Retry-After` and `X-RateLimit-*` headers where
   present; Cloudflare edge responses may omit the latter.
3. For a legitimate integration, use an API key or OAuth. For an abusive source,
   adjust only the relevant Cloudflare rule or application bucket; do not
   disable all protection. Confirm ordinary visitors can search and open
   profiles afterward.
4. If a release changed behavior, use the current production release's protected
   rollback path in the
   [Cloudflare publication guide](../deployment/cloudflare-publication.md). The
   initial cutover uses its immutable Worker version because it has no promotion
   journal.

Use `pnpm web:doctor` and the protected production `doctor` for read-only
configuration and provider checks. Hosted routing and release changes go through
**Deploy Production**. The retired `pnpm bootstrap --api-domain` and
`--api-edge` commands cannot modify DNS or rate-limit rules.

After a change, run the hosted smoke suite with
`ATLAS_HOSTED_PUBLIC_URL=https://atlas.rebuildingus.org` and
`ATLAS_HOSTED_API_URL=https://atlas-api.rebuildingus.org`, then inspect the next
production canary result.
