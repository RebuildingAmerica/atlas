# Web hosting migration

[Deployment](./README.md) > Web hosting migration

This work protects the experience of searching Atlas, reading source-linked
profiles, signing in, and using paid workspaces while replacing the fixed Vercel
hosting fee. The approved destination is Cloudflare-only hosting using `cf`.
**Atlas production remains on Vercel; its Cloudflare cutover is not complete.**
The separate organization website has completed its move and Vercel retirement.
There is no automatic paid Cloudflare fallback and no capability may be removed
to meet a limit.

The operator requires Google billing to remain closed. Do not reopen or relink
billing accounts. On October 10, 2026, the operator authorized the
[Cloudflare-only hosting plan](../superpowers/plans/2026-10-10-cloudflare-only-hosting.md),
including migration of API and discovery compute and evaluation of Durable
Objects against their own CPU and duration limits. The original whole-app 8ms
CPU gate applies to the direct Worker experiment, not the revised object
architecture. Runtime-specific limits, shared Free allowances, latency, privacy,
and complete product journeys remain release gates. Existing PostgreSQL, data,
PDS identities, and public URLs must be preserved. The hybrid path is retained
temporarily as historical implementation, not a selectable hosted target. Actual
provider checks and hosted journeys must pass before cutover, including a
working API for search and source-linked profiles. The operator also authorized
immediate cutover once those checks pass, waiving the original 24-hour staging
and 72-hour production waits. Do not fabricate elapsed observation evidence to
satisfy a command that still enforces the original windows.

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

## Implemented evaluation paths

| Candidate | Build and runtime                                                                                                                                 | What remains to establish viability                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Workers   | TanStack Start with the Cloudflare Vite adapter, PostgreSQL through Hyperdrive with caching disabled                                              | Hosted request CPU, free quotas, memory/connections, complete identity and billing journeys |
| Hybrid    | Exact verified Nitro output in a guarded Node container; Workers serves static assets and streams dynamic requests to a pinned Cloud Run revision | Hosted warm/cold latency, account-wide added cost, complete journeys                        |

The table records the original direct-Worker and hybrid experiments. The active
Cloudflare-only work evaluates the web runtime and the existing Python API in
Durable Objects, with Hyperdrive to retained PostgreSQL. Its current hosted
results and remaining limits are in
[Cloudflare-only runtime validation](./cloudflare-python-validation.md). Hybrid
is historical implementation and is not an authorized alternative.

`ATLAS_WEB_RUNTIME=workers` enables the Cloudflare adapter and a request-scoped
PostgreSQL implementation and per-dispatch authentication state. The auth
engine's configuration is reused; physical SQL clients remain request-owned.
`ATLAS_WEB_RUNTIME=node` enables Nitro. The adapters are mutually exclusive.
Omitting the variable preserves the existing Node/Vercel build behavior. Node
and SQLite remain available for local/self-hosted installations.

The native Worker imports the reflection polyfill needed by passkey
dependencies, excludes the native SQLite implementation, and holds request
resources through stream completion/cancellation. The release job owns schema
changes. Hosted requests verify `atlas_runtime_schema`; Workers remember only a
completed successful check for the last verified database in that isolate, never
an in-flight query or client. Hosted requests never create tables or run
migrations.

The hybrid publisher packages the prepared server output with
`services/web-edge/Dockerfile`; it does not rebuild the application. Traced
internal links are materialized before hashing so the container needs no
checkout or package installation. The source Dockerfile at `app/Dockerfile`
remains the self-hosted path.

The Workers target prerenders only Home and Privacy as public HTML, with route
discovery and link crawling disabled. Their metadata and browser interactions
remain intact, while opening them avoids request-time rendering. Profiles and
account flows retain live handlers; the Node target keeps its existing
rendering.

Static asset routing is exact, with HTML trailing-slash removal and without SPA
fallback. Only directories verified to contain fingerprinted assets receive
immutable caching. Dynamic responses are private and uncached. Application
`/api/auth`, billing and server functions stay in the app; only the existing
documentation, MCP and entity routes proxy to their configured upstreams. The
guarded origin checks its dedicated secret before **every** route, validates the
expected public host and replaces untrusted forwarding headers.

## Current evidence and blockers

The [Cloudflare-only runtime report](./cloudflare-python-validation.md) records
the current evidence:

- The organization website is on Cloudflare, version prefix `0e132a50`, source
  prefix `5fecdc0`;
  [workflow 38115026693](https://github.com/RebuildingAmerica/website/actions/runs/38115026693)
  passed. Its Vercel project is paused, Git-disconnected and has no domains.
  Atlas remains the active dependency on the paid subscription.
- The protected full API candidate, version prefix `44b88f`, source `234848ff`,
  returned health HTTP 200 in roughly 14 seconds. Entities returned HTTP 500;
  logs identify thread creation in a synchronous FastAPI dependency. Earlier
  memory failures are not the established cause of this latest failure. Repeated
  imports remain roughly 13 seconds; warm reuse is unproven.
- The latest retained account dashboard snapshot reports 18,850 daily Workers
  requests, 249 daily Durable Object GB-seconds, and 22.08k month-to-date
  Workers requests. These readings do not replace a complete peak/load forecast.

The [earlier hosted validation report](./web-hosting-validation.md) records the
direct Worker experiment, PostgreSQL release migration, browser checks, CPU
measurements, version rollback and credential recovery. That experiment failed
its 8ms CPU gate; this does not measure the revised Durable Object architecture.
Cloud Run remains blocked by `BILLING_DISABLED` and Google billing must remain
closed. The inventory below is historical, from before diagnostic resources and
traffic were created; current resource and usage observations above supersede
it.

Local verification on 2026-10-10 established (the `cf` conversion also passed
both prebuilt deployment dry runs):

- Node, Vercel, Workers and both Linux container builds succeed. The minified
  native upload is approximately 8.5 MiB uncompressed (2.3 MiB gzip).
  [Current Workers limits](https://developers.cloudflare.com/workers/platform/limits/#worker-size)
  allow 64 MiB uncompressed on Free; compressed size is informational, with no
  compressed-size limit. This is not a request CPU measurement.
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

Cloudflare-only is the approved architecture direction. A complete
operating-cost and quota forecast, Atlas production cutover, coordinated
rollback readiness and shared subscription cancellation are not yet established.
The observation-window waiver is not a claim that either elapsed window was
measured.

At an earlier local checkpoint, the app suite passed 4,167 tests with 100%
statement, branch, function and line coverage. All 22 repository lint/type-check
tasks, 135 deployment tests and 159 bootstrap tests passed without changing
coverage thresholds. These are local checks, not a current all-repository result
or complete hosted acceptance. The current Python report distinguishes local
checks from the deployed API probes.

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

The following hybrid bootstrap documents the original implementation only.
Google billing must remain closed, so it is not a migration step under the
current authorization. Its original purpose was to prepare the existing
`atlas-deploy` identity for account-status checks:

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

Migration builds compile `ATLAS_PUBLIC_URL` to the canonical origin and expose
the nonsecret `ATLAS_WEB_CANONICAL_URL` marker. The manifest records both
`publicEnv` (runtime) and `buildPublicEnv` (compiled configuration). Search and
social links retain the canonical profile URLs; browser API calls and custom
sign-in paths use the current hostname. Server authentication still receives the
candidate runtime origin for callbacks. This permits production to reuse the
verified server and assets with canonical runtime bindings. Changing bindings
creates a new provider version and requires fresh production probes; candidate
observation journals cannot count as production observation.

Publication records an opaque, salted commitment to the original runtime
configuration. It contains no credential values and cannot authenticate to Atlas
or a provider; it travels with the archived deployment metadata. Promotion
checks it against the unchanged production runtime, including optional identity,
email and Stripe settings. Candidate-only public and introspection URLs are
excluded because the publisher deliberately changes them. Origin protection
secrets remain in the private journal and never enter the archive. Older
candidates without this commitment must be republished.

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

## Runtime synchronization

`web:sync-runtime` reads the exact Vercel environment inventory and preserves
every configured application value, including optional enterprise identity,
email and billing settings. Production uses Vercel's production target; staging
requires its explicit custom environment ID. It ignores provider-only build
settings and explicitly enables the managed account/workspace mode required by
this migration, including for older deployments where it was implicit. It
rejects an explicitly disabled account/workspace mode. It never creates or
rotates signing keys, database credentials or payment secrets.

```sh
pnpm web:sync-runtime --target production \
  --project prj_v1sY5KyDpC3vIWj11UMUjf4QKjH3 \
  --team team_IA08hNlo8bXnaFX10JyZbNVz \
  --output .atlas/web/production-runtime.json --doctor
```

Supply the existing `VERCEL_TOKEN` through the process environment. The doctor
reads and validates without writing files or GitHub secrets. Remove `--doctor`
to save the canonical runtime with owner-only permissions under ignored
`.atlas/`. Add `--sync-github` to synchronize `ATLAS_WEB_RUNTIME_ENV_JSON` to
the matching GitHub environment using stdin, with provider output suppressed.

Vercel's write-only variables cannot be recovered through its API. Supply those
unchanged values from the existing secret store using
`--existing-runtime <private-json-file>`. This file can contain only the missing
values or the complete existing runtime. Conflicting readable values, unknown
keys, missing configured optional values and undecrypted ciphertext fail before
replacing the runtime or updating GitHub. This is a recovery fallback for the
provider restriction, not a requirement to copy credentials into chat.

## Rollback preparation

After candidate publication, `web:archive --directory <release-directory>`
retains the exact server, assets, manifest and published deployment in
`release.tar.gz`, with a SHA-256 readback in `archive.json`. It verifies both
artifact digests, refuses symbolic links and checks for embedded runtime secret
values before archiving. Private origin journals and runtime files are excluded.
The candidate workflow retains the archive for 30 days, even if subsequent
probes fail. This preserves older client assets with their matching server.

Before changing the canonical domain, capture its current recovery point:

```sh
pnpm web:capture-rollback --target production \
  --hostname atlas.rebuildingus.org --owner willie@rebuildingus.org \
  --project prj_v1sY5KyDpC3vIWj11UMUjf4QKjH3 \
  --team team_IA08hNlo8bXnaFX10JyZbNVz \
  --output .atlas/web/rollback-vercel-<timestamp>.json
```

The command uses the configured `cf` profile/token and explicit Cloudflare
account/zone plus `VERCEL_TOKEN`. It reads the live Vercel alias, ready
immutable deployment and DNS records without provider writes. The snapshot
preserves the unproxied Vercel CNAME and coexisting mail/verification records,
and records a digest of the deployment API's routing field. If that field is
explicitly null, the snapshot records `routeInventory: provider-null` and a null
route count; it does not invent a route export. Generated routing remains
attached to the retained immutable Vercel deployment. It excludes route-header
values, provider environment values and bypass credentials. Existing snapshot
files cannot be overwritten. A snapshot and retained archive are preparation; a
successful routing rollback still requires deployed verification.

`web:rollback-vercel` implements the initial migration's return to Vercel. Its
default mode only checks readiness. It requires the published canonical
production release, explicit provider identities, the retained Vercel snapshot,
and matching portable artifacts:

```sh
pnpm web:rollback-vercel --target production \
  --directory .atlas/web/production/<full-commit>/<architecture> \
  --snapshot .atlas/web/rollback-vercel-<timestamp>.json \
  --hostname atlas.rebuildingus.org --owner willie@rebuildingus.org \
  --project prj_v1sY5KyDpC3vIWj11UMUjf4QKjH3 \
  --team team_IA08hNlo8bXnaFX10JyZbNVz
```

Add `--apply` to restore routing. The command verifies the active Worker
version, retained Vercel alias/deployment/routing and unchanged mail records
before any mutation. `cf workers triggers deploy --prebuilt` removes only the
canonical domain, retaining the protected candidate domain; it does not upload
or rebuild code. The nonempty candidate domain is required because this CLI
version skips custom-domain reconciliation when the desired list is empty. The
command then restores the saved unproxied CNAME through `cf dns records batch`,
checks DNS again, and leaves an atomic private recovery journal. An interrupted
detach can resume only with that exact journal. Unknown routing records, changed
mail or verification records, unexpected domains and changed releases fail
explicitly. Immediate sign-in, profile, workspace and billing verification is
required after routing restoration. This command does not cancel Vercel or
implement rollback between replacement releases.

## Production promotion

This section describes the existing original-candidate command contract. The
operator has since waived the 24/72-hour waits for the Cloudflare-only
migration; these commands must not be represented as waiver-aware unless that
behavior is implemented and tested. Their observation durations below describe
the helper, not a renewed operator requirement.

`web:promote` checks the selected architecture, exact portable staging
artifacts, compiled configuration, preserved runtime credentials and actual
protected staging observation journal. It derives the 24-hour window from
individual samples; a summary flag in the evidence file cannot replace those
samples. The baseline must end within 48 hours and the latest successful sample
must be within ten minutes. Its default mode performs local validation without
writes:

```sh
pnpm web:promote --target production \
  --source .atlas/web/staging/<full-commit>/<architecture> \
  --journal .atlas/web/staging/<full-commit>/<architecture>/observations.jsonl \
  --evidence .atlas/web/evidence.json
```

Supply the unchanged canonical production runtime through
`ATLAS_WEB_RUNTIME_FILE` or `ATLAS_WEB_RUNTIME_ENV_JSON`, and the existing
hosted verifier and Access credentials through the same trusted environment used
for candidate publication. To perform cutover, add `--apply`, a separate
`--directory .atlas/web/production/<full-commit>/<architecture>`, and the
explicit `--hostname`, `--owner`, `--project` and `--team` inputs shown for
rollback above. The configured Cloudflare account/zone must match the staged
release. The publisher also requires the exact clean source commit.

Promotion captures and saves the current Vercel recovery point, copies the
verified bundles without rebuilding, and publishes canonical runtime bindings
behind a protected candidate hostname first. Hybrid reuses the staged immutable
image digest and creates a separate production revision. It archives the new
release and rechecks staging freshness and rollback readiness before using
`cf workers triggers deploy --prebuilt` to attach the canonical domain. It
immediately runs production probes; routing or probe failure invokes the saved
Vercel rollback. Failed recovery is reported explicitly with the retained
snapshot and journal available for manual retry.

The resulting deployment records the canonical `productionUrl` and a new Worker
version. Continue `web:observe --target production --hours 72 --watch` with that
deployment and the version-specific journal path printed by promotion.
Production observation uses the public canonical domain without sending
candidate Access credentials. A failed promotion cannot be observed as active
production. These automated probes do not replace the required real sign-in,
passkey, OAuth/SSO, checkout, webhook, workspace, mobile or rollback journeys.
Keep the original host and all rollback resources during observation. Provider
cutover and automatic recovery still require deployed verification; neither has
been executed for this branch.

## Deployed observations

Candidate publication is followed by `web:observe` against its actual protected
URL. Before provisioning, the publisher verifies that the runtime already
contains the enabled protected hosted verifier and that its secret matches the
trusted workflow's `ATLAS_HOSTED_E2E_SECRET`. It also requires the Access
credential pair. It never enables test routes or replaces identity secrets.

The observer checks public SSR pages, published person and organization pages,
external links in profile HTML, catalog reads, API health, a private anonymous
session response, docs, both MCP OAuth challenges and the existing Stripe
runtime inventory from the exact commit. Stripe inventory checks the preserved
canonical webhook metadata; it does not establish webhook delivery to the
candidate. Every sample reads the active Worker version through `cf` and matches
the artifact and asset digests. For hybrid, it also reads the Cloud Run revision
tag, image digest and readiness. It checks Access denial and direct-origin
rejection. Access credentials only follow redirects within the candidate origin;
the hosted verifier secret is sent only to its inventory endpoint. Journals
contain fixed check names, status and duration, never response bodies, cookies,
user identities, credentials or raw provider diagnostics.

Run one observation, or keep collecting every five minutes:

```sh
pnpm web:observe --target staging \
  --deployment .atlas/web/staging/<commit>/workers/deployment.json \
  --journal .atlas/web/staging/<commit>/workers/observations.jsonl

pnpm web:observe --target staging \
  --deployment .atlas/web/staging/<commit>/workers/deployment.json \
  --journal .atlas/web/staging/<commit>/workers/observations.jsonl --watch
```

The watcher runs locally and adds no separately hosted monitoring service. Keep
the process and private journal available throughout the observation period;
stopping it for more than ten minutes resets the continuous window. Failures
also reset the window. Mixed origins, commits, targets, architectures, Worker
versions, artifact digests or hybrid revision identities and out-of-order or
future timestamps are rejected. `--summary-only` reads the existing journal
without credentials or network requests and exits nonzero until a fresh
continuous 24-hour window passes. `--hours 72` applies the helper's original
longer window; it does not prove that production routing changed or supersede
the operator's waiver.

These probes are ongoing operational evidence, not complete product acceptance.
They do not establish real email/passkey/OAuth/SSO sign-in, paid checkout,
signed webhook delivery, invitation batches, concurrent-user isolation, mobile
interaction, Worker CPU or cold-start performance. Those release gates remain
separate. Request durations in the journal must not be relabeled as Worker CPU
or a representative latency percentile. The candidate workflow retains its
redacted first observation alongside the release identity.

## Original assessor and evidence model

The original assessor below selects between direct Workers and hybrid. It does
not select the currently approved Cloudflare-only Durable Object architecture.
Retain its measured baseline and quota discipline, but evaluate each current
runtime against its applicable limits and the unchanged product journeys.

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

The destination is Cloudflare-only. Existing promotion and Vercel rollback
commands are implemented for the original candidate model; their presence does
not prove the revised API/discovery architecture is ready or that Atlas has cut
over. Complete these remaining requirements:

1. Make the full API work in the hosted runtime, then verify search, maps,
   profile SSR/source links, docs, MCP, deep links, mobile navigation and
   failure states. Verify email, existing/new passkeys, recovery, invitations,
   ATProto/OAuth, configured SSO, Stripe test checkout and signed webhook
   handling, entitlement readbacks and canonical JWT acceptance. Preserve the
   existing canonical Stripe endpoint; its metadata does not prove candidate
   webhook delivery.
2. Verify bounded, resumable discovery and Firehose delivery through restart,
   retry and cancellation. Activate existing outbox rows on one designated
   object and hand off the old consumer safely. Local checkpoint and alarm tests
   do not establish hosted execution or resource limits.
3. Measure representative cold/warm/load traffic and shared Free usage against
   the relevant Worker and Durable Object limits. Verify Access denial, public
   metadata, spoofed-header rejection, session continuity and cross-user
   privacy. A successful health probe does not establish latency, memory or
   search acceptance.
4. Complete configuration synchronization, authenticated probes, redacted
   telemetry, quota alerts and exact rollback artifact retention for the current
   architecture. Capture Vercel deployment, routes/domains and rollback
   ownership before switching the existing Atlas domain. The operator waived the
   24/72-hour waits; command support for that explicit waiver must not
   substitute invented observation journals.
5. Immediately verify production sign-in, SSR, workspaces, billing and API
   journeys. Roll back broken journeys, privacy failures or failed performance
   gates. Remove obsolete integrations and revoke credentials after the
   replacement and rollback work in production; the waiver does not remove
   recovery requirements.
6. The organization website has already left active Vercel hosting. After Atlas
   and any remaining subscription dependencies are verified clear, cancel or
   downgrade the shared subscription and confirm the recurring charge ended.
   Website retirement alone does not prove those savings.

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
