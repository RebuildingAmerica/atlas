# Web hosting migration

[Deployment](./README.md) > Web hosting migration

This work protects the experience of searching Atlas, reading source-linked
profiles, signing in, and using paid workspaces while replacing the fixed Vercel
hosting fee. Both hosting candidates are implemented for evaluation using `cf`.
**Vercel remains the active host. Neither candidate is approved for
production.** There is no automatic paid Cloudflare fallback and no capability
may be removed to meet a limit.

The operator requested that implementation continue assuming Google billing will
be available. Do not reopen or relink billing accounts. Continue building and
validating both deployment paths; actual provider checks and hosted journeys
must still pass before deployment and cutover. The Workers candidate also
depends on the existing API and PostgreSQL; moving the web runtime does not
replace those services.

## Required Cloudflare CLI

The migration uses the new `cf` CLI, pinned to `1.0.0-beta.14` in the
repository. Account inspection, Hyperdrive, Access, builds, type generation and
candidate publication all use `cf`. Do not substitute direct Wrangler commands
or a raw Cloudflare HTTP client. This keeps the tested deployment path
consistent so profiles, private sessions and rollback artifacts retain the same
behavior.

Authenticate from the migration checkout:

```sh
pnpm exec cf auth create atlas
pnpm exec cf auth activate atlas
pnpm exec cf auth whoami
```

Approve the browser request within five minutes. `cf` keeps its own credentials;
a Wrangler login does not authenticate `cf`. Keep the Atlas profile separate
from other organizations. Local management commands require
`ATLAS_CF_PROFILE=atlas` and the verified `CLOUDFLARE_ACCOUNT_ID`; CI requires
the scoped `CLOUDFLARE_API_TOKEN`. Neither credential goes into build output or
manifests.

Both candidates use `cloudflare.config.ts` and `cf` Build Output. The native
application uses the matching Cloudflare Vite plugin beta. The small proxy
Worker uses `cf`'s supported internal bundler with `wrangler.config.ts`;
Wrangler is an internal compiler dependency, never the migration's CLI
interface. `cf deploy --prebuilt` consumes the verified bundle without
rebuilding and receives runtime secret values only through a temporary mode-600
file. Mutation bodies containing database credentials also use mode-600 files,
never command arguments. Those files are removed even when the command fails.

## Implemented candidates

| Candidate | Build and runtime                                                                                                                                 | What remains to establish viability                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Workers   | TanStack Start with the Cloudflare Vite adapter, PostgreSQL through Hyperdrive with caching disabled                                              | Hosted request CPU, free quotas, memory/connections, complete identity and billing journeys |
| Hybrid    | Exact verified Nitro output in a guarded Node container; Workers serves static assets and streams dynamic requests to a pinned Cloud Run revision | Hosted warm/cold latency, account-wide added cost, complete journeys                        |

`ATLAS_WEB_RUNTIME=workers` enables the Cloudflare adapter and a request-scoped
PostgreSQL/auth implementation. `ATLAS_WEB_RUNTIME=node` enables Nitro. The
adapters are mutually exclusive. Omitting the variable preserves the existing
Node/Vercel build behavior. Node and SQLite remain available for
local/self-hosted installations.

The native Worker imports the reflection polyfill needed by passkey
dependencies, excludes the native SQLite implementation, and holds request
resources through stream completion/cancellation. The release job owns schema
changes. Hosted requests only verify `atlas_runtime_schema`; they never create
tables or run migrations.

The hybrid publisher packages the prepared server output with
`services/web-edge/Dockerfile`; it does not rebuild the application. Traced
internal links are materialized before hashing so the container needs no
checkout or package installation. The source Dockerfile at `app/Dockerfile`
remains the self-hosted path.

Static asset routing is exact, without SPA fallback. Only directories verified
to contain fingerprinted assets receive immutable caching. Dynamic responses are
private and uncached. Application `/api/auth`, billing and server functions stay
in the app; only the existing documentation, MCP and entity routes proxy to
their configured upstreams. The guarded origin checks its dedicated secret
before **every** route, validates the expected public host and replaces
untrusted forwarding headers.

## Current evidence and blockers

Local verification on 2026-10-10 established (the `cf` conversion also passed
both prebuilt deployment dry runs):

- Node, Vercel, Workers and both Linux container builds succeed; the minified
  native upload is about 2.3 MiB gzip, below the documented 3 MiB Free bundle
  limit. This is not a request CPU measurement.
- Serialized migrations ran twice successfully on an isolated PostgreSQL 18
  database.
- Native workerd and the Linux Node container each returned the correct
  identities for 16 overlapping requests across two test sessions. This does not
  prove real email, passkey, OAuth, SSO or Stripe operation.
- The origin rejects requests without its secret. Tests cover forwarding
  spoofing, separate cookies, redirects, streaming, route ownership and artifact
  identity.
- A real Chromium test verifies that Access credentials survive Atlas redirects
  and never reach an external origin.

Read-only provider inventory on 2026-10-10 established:

- Vercel authentication works. The Rebuilding America Project Pro team contains
  `atlas` and `rap-website`; the latter must be accounted for before
  cancellation. Atlas's production and staging domains, environment key names
  and current production deployment were captured locally under ignored
  `.atlas/` files, without environment values. Production remains on Vercel. The
  metrics API supplies the workload report below. Billing usage reports monetary
  units; it cannot substitute for request, response, latency and workload mix
  measurements.
- The Atlas Google Cloud account (`willie@rebuildingus.org`, `rap-atlas-prod`)
  is authenticated again as of 2026-10-10. The default CLI project belongs to
  another project; deployment commands must always receive the explicit Atlas
  project and account.
- The new `cf` profile `atlas` is authenticated to the Rebuilding America
  account. `rebuildingus.org` is an active Free zone. Atlas's CNAME still
  targets Vercel; its mail and verification records must also be preserved. The
  account contains the unrelated `curfew-sync-staging` Worker. Hyperdrive has no
  configurations; a SQL API query returned zero Hyperdrive queries over the same
  14-day window. The account-wide billing usage endpoint returns HTTP 403 for
  this OAuth profile. The **Rebuilding America Chrome profile** can read the
  dashboard: it reports zero account requests, CPU time, observability events
  and Workers build minutes for October 1–10, with zero requests today against
  the 100,000 daily limit. This is a month-to-date dashboard observation, not a
  complete 14-day daily export. The existing Worker's selected September 26–
  October 10 UTC chart says zero invocations and “No data”; that empty chart
  does not independently prove daily zeros. The account also contains the
  unrelated `lvbt-website` Pages project. Its latest production deployment has
  `uses_functions: false`, confirmed through `cf pages list`. Preserve both
  unrelated applications. Scoped CI credentials and repeatable quota telemetry
  are still required.
- Four Google Cloud projects share Atlas's billing account. Their usage must be
  included when determining remaining free allowances. The existing `atlas-web`
  Cloud Run service predates this migration; the publisher uses separate target
  services. The linked billing account now reports **`open: false`**. Although
  the project reports `billingEnabled: true`, Artifact Registry rejects reads
  with `BILLING_DISABLED`. Hybrid provisioning is blocked. `web:doctor` and the
  hybrid publisher now inspect the linked account itself, without changing the
  CLI's global account or project. Restoring billing is an operator action;
  these commands never reopen or relink billing accounts.
- After browser identity verification, the Google billing account report for
  October 1–10 (Pacific time) shows $3.11 net charges: $2.96 Compute Engine,
  $0.10 Artifact Registry, $0.04 Cloud Run and
  $0.01 Cloud Storage. Cloud Run
  consumed 24,049.47 CPU-seconds, 9,566.1 GiB-seconds and 4,556 requests;
  its reported compute charges were offset by credits. Its North America
  internet transfer was 1.26 GiB ($0.03),
  plus 0.5 GiB carrier peering
  ($0.01).
  Artifact Registry stored 1.53 GiB-month; Cloud Logging ingested 0.02 GiB.
  Rounded charges and applied credits do not establish remaining free
  allowances. The account's $13.95
  month forecast describes existing usage, not the added cost of either
  migration candidate. Redacted observations are retained under ignored
  `.atlas/web/` files; no CSV export was obtained.
- Two read-only requests to the existing production API's `/health` endpoint
  returned HTTP 500 and 503. The cause has not been established; successful API
  operation is required before either candidate can pass hosted journeys. A
  subsequent check after browser verification still returned HTTP 503. These
  gates protect sign-in, searchable profiles and workspace operations during the
  move; provider authentication alone does not prove those experiences.

The 14-day request/response workload baseline is complete. Shared account
cost/quota measurements and deployed acceptance remain release blockers.
Provider login alone does not satisfy those gates.

Documentation retrieval has a separate limitation:

- Context7 documentation retrieval reached its monthly quota. Restore it with
  `npx ctx7@latest login` or `CONTEXT7_API_KEY`. Official Cloudflare
  documentation was used for this implementation.

No complete operating-cost estimate, architecture selection, observation window,
production cutover, rollback readiness or subscription cancellation is claimed.

The final app suite passed 4,167 tests with 100% statement, branch, function and
line coverage. All 22 repository lint/type-check tasks, 135 deployment tests and
159 bootstrap tests passed without changing coverage thresholds. These are local
checks; no remote CI run or hosted acceptance has been completed for this
branch.

## Refresh the workload baseline

Use the authenticated Vercel CLI session and explicitly select Atlas's team and
project. The command only reads metrics. Supply 14 complete UTC days, with ISO
timestamps at midnight UTC and an end within the last 48 hours:

```sh
pnpm web:baseline \
  --scope rebuilding-america-project --project atlas \
  --since 2026-09-26T00:00:00Z --until 2026-10-10T00:00:00Z \
  --output .atlas/web/baseline-vercel-2026-10-10.json
```

The report separates production from preview, static assets from function and
external requests, bot classifications, response sizes, server CPU/duration and
warm/cold starts. All byte and compute totals use explicit sums. Daily buckets
use UTC; changing the window changes the totals. `function_start_type` values
come from Vercel (`hot`, `cold`, `prewarmed`), without treating prewarmed
traffic as warm traffic. Missing values remain unknown. A null daily percentile
is explicitly not applicable only when the matching production invocation count
for that exact day and start category is measured as zero. The raw null stays in
the report with its explanation; it never becomes a zero-millisecond latency.
Failed queries, missing daily observations, unexplained null values, mismatched
query readbacks or a grouped bucket reaching its 100-group cap make collection
incomplete and exit nonzero. Valid aggregate summaries remain available when
daily observations are partial. Reports stay under ignored `.atlas/` paths with
mode-600 permissions.

The UTC window above measured 33,070 requests (32,286 production), 174,737,080
response bytes, and a peak of 11,426 requests in one day across environments.
Production server invocations had p95 time to first byte of about 1,200 ms for
`hot` starts and 13,906 ms for `cold` starts. These aggregate all application
server journeys; they are not an SSR-only comparison. Warm production p99 CPU
was about 600 ms on Vercel, a significant compatibility risk for Workers Free,
not a measurement of Workers execution. Source data is retained locally in the
report. The refreshed live run completed all 18 measurements. Three October 4
cold-start percentiles are not applicable: the matching count is zero. This
cross-check removes a false missing-data blocker without changing measurements.

Collection success only means the requested Vercel queries returned usable
results. This report is not migration approval or a completed evidence file:
account-wide quota and billing usage, representative hosted measurements and the
remaining acceptance gates still apply.

## Repository commands

```sh
pnpm web:doctor --target staging
pnpm web:bootstrap-google-billing --target staging
pnpm web:baseline --scope <team> --project <project> --since <ISO> --until <ISO> --output .atlas/web/baseline.json
pnpm web:types
pnpm web:types --check
pnpm web:typecheck
pnpm web:assess --target staging --evidence .atlas/web/evidence.json
pnpm web:prepare --target staging --architecture workers
pnpm web:prepare --target staging --architecture hybrid
pnpm web:migrate-auth
```

`doctor` is read-only. It reports missing configuration/provider access without
switching global accounts or creating resources. `prepare` builds locally and
writes redacted manifests under `.atlas/web/<target>/<commit>/<architecture>/`.
A dirty build is marked nondeployable. Candidate publication requires a clean
committed checkout and matching server/assets digests. Build configuration is
compared to runtime.

`web:migrate-auth` requires the target PostgreSQL URL and existing
signing/runtime configuration. It holds a PostgreSQL advisory lock, runs
idempotent Better Auth and ATProto migrations, and records the schema version.
It is an additive release job; review future schema changes for compatibility
with both the current and rollback releases before changing that version.

Provider inputs are `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`,
`CLOUDFLARE_API_TOKEN` (CI) or `ATLAS_CF_PROFILE` (local), `GCP_PROJECT_ID`,
`GCP_REGION`, optional `ATLAS_GCP_ACCOUNT`, `VERCEL_ORG_ID`, `VERCEL_TOKEN`, and
`ATLAS_WEB_EVIDENCE_FILE`. Never place tokens in Git, release manifests, build
arguments, logs or image layers.

The managed runtime is supplied as `ATLAS_WEB_RUNTIME_ENV_JSON` in the target
GitHub environment. It contains the **existing** auth signing secret, database
URL, email, Stripe, PDS and configured identity settings. Provider-management
credentials are rejected. Synchronize this object from the authorized existing
runtime; do not invent replacement signing secrets or RP IDs. Local child
commands can read an ignored mode-600 runtime file through
`ATLAS_WEB_RUNTIME_FILE`.

## Protected candidate publication

The manually dispatched **Verify web hosting candidate** workflow runs full
existing CI before provisioning. It accepts staging from `main` or a release tag
and production candidates only from release tags. Pull requests never receive
deployment secrets. Existing GitHub Actions dependency/build caches remain in
use.

For hybrid, after the operator restores the existing Google billing account,
prepare the existing `atlas-deploy` identity for the account-status check:

```sh
pnpm web:bootstrap-google-billing --target staging
```

This requires explicit `GCP_PROJECT_ID` and `ATLAS_GCP_ACCOUNT`. It verifies the
project's linked account is open, discovers that account's organization, and
creates/reuses `atlasWebBillingStatusReader` with exactly
`billing.accounts.get`. It binds that custom role only on the linked billing
account and only to `atlas-deploy@<project>.iam.gserviceaccount.com`, then
verifies the role and binding. It never grants billing management, payment
information or account-wide cost-reading permissions. A broader existing role,
closed account, absent organization, missing deployment identity or insufficient
operator permissions blocks setup explicitly. Google requires
[organization-level custom roles for billing accounts](https://docs.cloud.google.com/billing/docs/how-to/custom-roles);
project-level roles cannot satisfy this guard. This setup is idempotent, and CI
then reads status through its existing workload identity. Effective CI access
still needs a real trusted workflow run; local command tests do not establish
remote permissions.

Synchronize the trusted verifier's Access service credentials:

```sh
pnpm web:bootstrap-access --target staging
```

This creates/reuses a local mode-600 service-token journal and synchronizes the
three Access credentials into the named GitHub environment. Preserve that
private journal for recovery. Required additional environment secrets are the
Cloudflare inputs above, `ATLAS_WEB_RUNTIME_ENV_JSON`, and existing Google WIF
inputs for hybrid. `ATLAS_WEB_EVIDENCE_JSON` is a nonsecret environment variable
with measured evidence.

Candidate preparation uses read-only zone metadata to derive
`atlas-<architecture>-<target>-<commit-prefix>.<canonical-host>`. Its runtime
uses that host for browser links and callbacks while retaining the canonical
issuer, MCP resource, signing secret and passkey RP ID used by the existing
API/accounts. This descendant hostname keeps the canonical RP ID valid in the
browser. Candidate Access policy must contain exactly the designated
service-token grant. Only `/api/atproto/oauth/client-metadata.json` receives a
separate public bypass: external ATProto authorization servers must fetch that
public client metadata. Certificate issuance and Access path precedence still
need deployed verification.

The workflow runs these steps, with the prepared runtime passed to child
commands:

```sh
node scripts/deploy/web-candidate.mjs prepare-runtime --target staging \
  --architecture hybrid --output .atlas/web/runtime.json
node scripts/deploy/web-runtime-command.mjs -- pnpm web:prepare \
  --target staging --architecture hybrid
node scripts/deploy/web-runtime-command.mjs -- pnpm web:migrate-auth
pnpm web:publish-candidate --target staging --architecture hybrid \
  --directory .atlas/web/staging/<full-commit>/hybrid
```

Publication requires a fresh measured baseline, free account confirmation and
quota headroom; hybrid additionally requires a ≤$5 forecast at twice traffic
before any new Cloud Run service is created. It uses request billing, minimum
zero, maximum four, concurrency eight, one CPU, 768 MiB memory and a 180-second
request timeout. Every attempt receives a distinct immutable revision tag so
partial deployment can be retried without changing a revision. A private local
recovery journal retains the origin secret; redacted `deployment.json` records
the successful Worker version, revision, image digest and candidate URL. Keep
previous release resources until rollback is verified; do not run a generic
cleanup across them.

A published candidate is **not** a promotion. The workflow does not fabricate
journey/performance results or switch the canonical domain.

## Evidence and selection

Start from
[the incomplete evidence template](./web-hosting-evidence.example.json). Null
values deliberately fail validation. Obtain at least 14 days of Vercel request
and workload observations, including bots, API proxies, response bytes,
cold/warm latency and errors. Include the source export/query, collection time,
peak-day counts and identity/billing workload mix. Read existing account usage
before allocating any shared free allowances.

Hybrid `monthly` includes **both staging and production**, compute, memory,
requests, Cloud Run-to-Cloudflare internet egress, registry storage, builds,
logs and incremental database/network charges. `freeRemaining` means measured
unused allowances across the billing account; never subtract the whole published
free tier from Atlas alone. Rates must correspond to the selected region and
current billing terms. Native `addedMonthlyCosts` includes database/network,
build, storage and logging overhead; Workers request/CPU billing remains zero
only while all Free limits pass.

The assessor reports both current and twice-traffic forecasts. It prefers native
Workers only after every required journey and limit passes: p99 CPU <8 ms, no
CPU limit failures, and doubled peak-day traffic/query use plus existing account
usage below 80% of Free quotas. Otherwise it selects hybrid only with warm p95
within 20% of baseline, cold SSR p95 ≤3 seconds, direct-origin protection and
≤$5/month added at twice traffic. If neither passes, retain Vercel. Budget
alerts are warnings, not a spending cap.

## Remaining release work

Provider access and measured evidence must be restored before architecture
selection. The following approved requirements remain open; these commands do
not implement production promotion, routing rollback or subscription retirement
yet:

1. Run actual hosted search, maps, profile SSR/source links, docs, MCP, deep
   links, mobile navigation and failure-state checks on each candidate. Verify
   email, existing/new passkeys, recovery, invitations, ATProto/OAuth,
   configured SSO, Stripe test checkout/webhook delivery and entitlement
   readbacks. External callbacks/webhooks must hit the candidate itself; a
   successful request to the current Vercel host is not candidate evidence.
   Verify canonical JWT acceptance by the unchanged API using tokens issued by
   the candidate.
2. Measure representative cold/warm/load traffic, p99 CPU, quotas and existing
   account usage. Verify unauthenticated Access denial, public metadata access,
   origin rejection, spoofed headers, session continuity after redeploy and
   cross-user privacy in the deployed runtime.
3. Select one architecture and complete its sole hosted deployment,
   configuration synchronization, authenticated probes, redacted telemetry,
   quota/cost alerts, durable rollback artifact retention and promotion/rollback
   commands. Replace Vercel readiness, repair, bypass and deployment
   integrations only after this.
4. Require 24 hours of successful staging on the exact release. The release gate
   helper checks commit, selected architecture, recent baseline and
   observations; it does not collect or attest observations. Capture current
   Vercel deployment, routes/domains and rollback ownership, then switch the
   existing domain.
5. Immediately verify production sign-in, SSR, workspaces and billing readbacks.
   Roll back broken journeys, privacy failures or failed performance gates.
   Retain Vercel for 72 hours. Remove SDKs/configuration and revoke obsolete
   credentials after the selected replacement and rollback work in production.
6. Clear other projects sharing the subscription, then cancel/downgrade and
   confirm the recurring charge ended. Moving Atlas alone does not prove
   savings.

## Local checks

```sh
pnpm deploy:test
pnpm bootstrap:test
pnpm actionlint
pnpm web:types --check
pnpm web:typecheck
pnpm --filter @rebuildingamerica/atlas-app run typecheck
pnpm --filter @rebuildingamerica/atlas-app run lint
pnpm --filter @rebuildingamerica/atlas-app run test
pnpm --filter @rebuildingamerica/atlas-app exec playwright test \
  --config playwright.hosting.config.ts
```

`web-local-sessions.mjs` is an optional local runtime probe. It accepts only
loopback PostgreSQL and runtime URLs, creates two disposable sessions, checks
overlapping identity reads, then deletes its users. It requires
`ATLAS_WEB_LOCAL_POSTGRES_URL`, `ATLAS_WEB_LOCAL_ORIGINS`, the local
`ATLAS_AUTH_INTERNAL_SECRET` and, when testing the guarded container,
`ATLAS_WEB_ORIGIN_SECRET`/`ATLAS_WEB_LOCAL_PUBLIC_HOST`. It must never be
pointed at retained production data.
