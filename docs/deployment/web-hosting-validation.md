# Hosted migration validation

Baseline validated October 10, 2026 against commit
`a14ff2135e7bf8e133741d2a644cf14245daa3ef`. CPU investigation and retained fixes
are from `60f7f895`, `688aa2e0` and `e7e661bd`; see the comparison below.

Atlas production remains on Vercel. The current Workers build does not meet the
approved CPU gate, and Google Cloud rejects registry access with
`BILLING_DISABLED`. Neither architecture is approved for production cutover.
Keeping the production routing protects existing accounts and avoids moving
searchable profiles onto an unverified replacement.

## Deployed diagnostic

The actual application, including SSR and static assets, was deployed through
the required `cf` CLI to the Rebuilding America Workers Free account:

- Worker: `atlas-hosted-diagnostic-a14ff2135e7b`.
- Protected primary hostname:
  `atlas-hosted-diagnostic-a14ff2135e7b.atlas.rebuildingus.org`.
- Additional protected diagnostic hostname:
  `atlas-hosted-diagnostic-a14ff2135e7b.rebuildingus.org`.
- Workers development and preview URLs remain disabled.
- Both hostnames require the exclusive Atlas staging Access service token.
- Hyperdrive uses the existing PostgreSQL database with query caching disabled.

This is a compatibility diagnostic, not a fully configured release candidate.
Its existing database, internal authentication and email credentials came from
Atlas's old Cloud Run deployment. The recovered internal authentication secret
was verified against Vercel production: an invalid control receives 401, while
the recovered secret reaches the expected missing-API-key response, 400. This
check neither authenticates a user nor changes sessions. That deployment does
not contain the current Stripe configuration. Vercel's production settings are
all write-only, and the available local production export contains empty
application values. No complete production-runtime attestation, full billing
validation or staging acceptance window is claimed.

The nested hostname initially failed TLS negotiation. Cloudflare subsequently
provisioned its certificate, and authenticated and unauthenticated HTTPS probes
now reach the expected application and Access denial respectively. The extra
hostname allowed initial diagnostics while that certificate was provisioning; it
is not evidence that existing passkeys work on an unrelated RP domain.

## Observed behavior

| Check                                 | Live result                                                               | Acceptance consequence                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Access protection                     | Unauthenticated request returns 403; service-token request reaches Atlas  | Protection works for the diagnostic                                       |
| Home, sign-in and privacy SSR         | HTTP 200, rendered Atlas content                                          | Initial rendering works                                                   |
| Canonical home URL                    | HTML points to `https://atlas.rebuildingus.org`                           | Candidate does not replace the public canonical URL                       |
| Static favicon and application assets | Served by Cloudflare                                                      | Assets are present                                                        |
| Documentation                         | `/docs` redirects to `/docs/what-is-atlas`; destination returns 200       | Documentation proxy works                                                 |
| Unsigned session                      | HTTP 200 and `null`; credential-free reads now bypass auth initialization | Anonymous behavior works; this alone does not validate signed-in sessions |
| Spoofed forwarding headers            | Unsigned session still returns `null`                                     | No identity is granted by the tested forged headers                       |
| Dynamic cache headers                 | `private, no-store`                                                       | Tested dynamic responses are not shared-cacheable                         |
| Entity search and MCP                 | HTTP 503 on Cloudflare and existing Vercel production                     | Existing API outage blocks discovery acceptance                           |
| Mobile sign-in and recovery controls  | Rendered in Chromium                                                      | Visual/control presence only; no real email or passkey journey claimed    |

The initial session probe returned 500 because `atlas_runtime_schema` did not
exist. The serialized release migration job completed successfully twice.
Before/after counts for users, sessions, passkeys and workspaces were unchanged,
and the schema marker is now `atlas-web-2026-10-10`. No existing signing
credentials were generated or rotated.

## Workers CPU result

Cloudflare invocation logs were collected with diagnostic sampling configured to
100%. The measured version was `151ad5c5-f948-4b53-b0ea-43bd3ed277ba`; the same
application artifacts were subsequently rebound to the protected nested
hostname.

| Sample                            | Invocations | CPU p50 | CPU p95 | CPU p99 |
| --------------------------------- | ----------: | ------: | ------: | ------: |
| All logged diagnostic invocations |         184 |     8ms |   120ms |   141ms |
| Home                              |          37 |     9ms |   101ms |   137ms |
| Sign-in                           |          36 |     8ms |   109ms |   132ms |
| Privacy                           |          26 |     8ms |    89ms |   120ms |

A burst exercised 150 public rendering and error-path requests with six requests
in each batch. It returned 100 HTTP 200 responses and 50 expected HTTP 404
responses, with wall-clock p95 approximately 739ms. No CPU-limit error pages
were observed. Separately, the live tail confirmed warm home/sign-in CPU
observations ranging from 4ms to 23ms. These are short diagnostic samples, not a
complete workload study or a successful performance gate.

The approved requirement is p99 CPU **below 8ms**, including cold requests, with
no CPU-limit failures. This build fails that requirement. HTTP 200 responses and
an approximately 11ms Worker startup reported during upload do not establish
adequate per-request CPU headroom. Do not promote it or silently upgrade the
Workers plan. See
[Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### CPU investigation and retained fixes

The new
[production CPU and heap profiler](https://developers.cloudflare.com/workers/observability/profiling-in-production/)
was invoked through `cf workers versions profile`, alongside local workerd CPU
profiles. Successful production profiles exposed cold module initialization,
page-router creation for session reads, request/header and abort handling,
rendering, and garbage collection. The allocation profile also showed React
rendering and router/query objects. These samples identify hotspots, not a
complete percentage breakdown of every invocation. Some later production profile
requests returned no recently active isolate; invocation CPU logs, not those
unsuccessful profiles, supply the comparison below.

Retained changes protect the first page and account checks without sharing
visitor state:

- Device authorization imports its backend only when its handler runs. The
  router's eager static dependency graph shrank from 166 modules / 2,833,704
  bytes to 160 modules / 1,053,571 bytes.
- Immutable router, Start and API-identity modules load during isolate startup,
  after the reflection polyfill. Routers, query caches, sessions and database
  clients are still created per request. The later auth configuration reuse
  described below does not reuse visitor identity.
- Credential-free `GET /api/auth/get-session` returns `null` directly with
  `private, no-store`. Access injects `CF_Authorization` even into service-token
  requests; that cookie alone is not an Atlas credential. All other cookies,
  malformed cookies and any authorization header still reach authentication.
- Credentialed reads of that exact session endpoint use the same HTTP auth
  dispatcher as the application route, without creating a page router. The CIMD
  and OAuth guards, forwarding-header sanitization, multiple cookies and request
  resource cleanup remain in place. Other routes and methods retain their
  existing handlers.

Before extracting the session dispatcher, clean-source version
`dd6a96e8-c616-40bc-9f7b-00516ad2cc44` at `688aa2e0` produced these results:

| Workload                                               | CPU samples / requests | CPU p50 | CPU p95 | CPU p99 |
| ------------------------------------------------------ | ---------------------: | ------: | ------: | ------: |
| Public SSR and expected 404s, five concurrent requests |            998 / 1,000 |     5ms |    35ms |    55ms |
| Credential-free session reads                          |                40 / 40 |     0ms |     0ms |     0ms |

Public requests covered `/`, `/sign-in`, `/privacy`, `/about` and
`/not-a-route`; `/about` is an expected 404. The run returned 600 HTTP 200s and
400 expected 404s, with no CPU-limit pages. Requests were matched to Cloudflare
invocation logs by ray ID. Missing logs were not counted as zero CPU. These
short runs are not a 14-day workload or successful release gate.

A session-dispatcher experiment returned `null` for ten invalid-cookie and ten
invalid-bearer controls, with median CPU of 13ms and 14ms respectively. Earlier
controls through the page router measured 38ms and 20ms. Credential-free reads
again measured 0ms across all 40 samples. Invalid credentials test rejection;
they do not substitute for real signed-in, passkey, OAuth or SSO journeys.

The final retained source was rebuilt cleanly and deployed as version
`15bda29d-83a5-4206-a448-4c0872bc5585` from
`e7e661bd6e1cc2745a169006eb309fa7865515f1`, through `cf`. Cloudflare reported
52ms startup and approximately 8.5 MiB uncompressed upload. A fresh comparison,
including authentication controls before public SSR, measured:

| Workload                                               | CPU samples / requests | CPU p50 | CPU p95 | CPU p99 |
| ------------------------------------------------------ | ---------------------: | ------: | ------: | ------: |
| Public SSR and expected 404s, five concurrent requests |            996 / 1,000 |     5ms |    34ms |    60ms |
| Credential-free session reads                          |                40 / 40 |     0ms |     0ms |     0ms |
| Invalid session cookie                                 |                50 / 50 |    14ms |    62ms |   239ms |
| Invalid bearer token                                   |                50 / 50 |    15ms |   222ms |   253ms |

All 100 credentialed controls returned `null`, HTTP 200 and `private, no-store`.
The public sample returned the same 600 successful pages and 400 expected 404s;
no probe received a CPU-limit page. Credentialed cold tails remain particularly
expensive. The dispatcher reduces median session cost but does not make the
authentication workload pass. The final 500 public requests still measured 48ms
p99 across 496 matched logs, so dropping the initial burst would not make this
sample pass either.

The full frontend suite passed: 620 files, 4,192 tests passed, one skipped, and
100% statement, branch, function and line coverage. Focused worker/session and
route tests, TypeScript, lint and formatting passed; both native Workers and
Node/Nitro artifacts built successfully. These checks preserve session routing,
cookie behavior and request isolation, but do not replace hosted acceptance.

Rejected experiments were removed from source and deployment:

- Disabling server minification still measured 42ms p99 across 996 matched
  public requests; the last 500 measured 16ms p99.
- Preloading every route component at startup still measured 56ms p99 across 995
  matched requests. Its startup was 104ms, but request CPU remained over budget.
- Preloading auth modules alone did not eliminate credentialed cold spikes and
  worsened the public CPU tail. This experiment preceded the configuration reuse
  described below.
- Inlining all SSR dynamic imports broke the Worker entrypoint in local workerd
  and was never deployed.

Neither a 0ms anonymous endpoint nor improved startup establishes that full SSR
and authentication fit Workers Free. The p99 below 8ms gate remains in force.
Further work must reduce rendering/authentication allocation and CPU, not merely
warm a shared HTML cache or exclude cold requests from the sample.

### Authentication configuration and public documents

The next investigation found that every Workers auth request rebuilt Better
Auth's plugin, schema and endpoint graph. The engine now reuses that
configuration, as the existing Node build already did. Better Auth's installed
dispatcher creates session and response-header state per invocation. A Kysely
PostgreSQL dialect resolves each physical client from the active Workers
request; no pool or connection is created at module initialization, and each
physical pool closes when its response finishes or is cancelled. In-flight
schema checks remain scoped to the request and migrations remain an external
release job.

Concurrent Kysely tests exercise separate request-owned pools. A disposable
local PostgreSQL database and the actual workerd bundle also passed sixteen
overlapping signed-session reads for two different users. These probes verify
isolation of synthetic sessions, not real email, passkeys, SSO or production
account recovery.

The first hosted configuration-reuse experiment,
`e0d83e7c-8abd-4c59-a597-6aa7baa809b1`, measured:

| Workload                     | CPU samples / requests | CPU p50 | CPU p95 | CPU p99 |
| ---------------------------- | ---------------------: | ------: | ------: | ------: |
| Invalid session cookie       |                50 / 50 |     3ms |     5ms |    36ms |
| Invalid bearer token         |                50 / 50 |     4ms |    11ms |    50ms |
| Credential-free session      |                40 / 40 |     0ms |     0ms |     0ms |
| Public SSR and expected 404s |            990 / 1,000 |     5ms |    31ms |    60ms |

Compared with the preceding retained build, invalid-credential median CPU fell
from 14–15ms to 3–4ms. Cold and rendering tails still fail the release gate.
Initializing the engine itself at isolate startup was also tested and removed:
it did not resolve the tails and would make static rendering depend on runtime
authentication secrets.

Zod was updated from 4.4.3 to 4.6.5 for the
[documented reduction in schema memory](https://github.com/colinhacks/zod/releases/tag/v4.5.0).
Cloudflare explicitly recommends 4.5 or later for Workers memory pressure. This
is not credited as a measured request-CPU improvement: the hosted Zod/startup
experiment still measured 71ms public p99 across 989 matched invocations.

The Workers build now prerenders only `/` and `/privacy`, with automatic route
discovery and link crawling disabled. These existing public documents contain no
visitor identity and retain their HTML, metadata, scripts and client behavior.
Cloudflare serves their exact generated assets with trailing-slash removal;
unknown paths still reach the application and return the existing 404 surface.
Profiles, sign-in parameters, workspaces, billing and server functions remain
live. The Node/self-hosted target keeps its existing rendering path. No
generated customer data or authentication secrets are added to public assets.

In experiment `59e3417d-b13b-4469-baa6-780831360c2d`, all 200 home requests and
200 privacy requests returned their static HTML and produced no Worker
invocation records. This is expected asset routing, not missing logs counted as
zero CPU. Browser checks at 390px verified the page titles, visible content and
absence of horizontal overflow or reported hydration errors; parameterized
sign-in retained `private, no-store`. The catalog API remains unavailable, so
these checks do not establish successful search or profile discovery.

The remaining live sign-in/404 workload still measured 54–70ms p99 by route; all
100 invalid-credential controls returned `null`, but cold cookie CPU reached
70ms. There were no CPU-limit pages in the 1,140-request probe. The full
frontend suite passed 621 files and 4,193 tests, with one skipped and unchanged
100% coverage thresholds. The candidate remains ineligible for production
cutover.

The retained changes were committed as `f09cac0a` and deployed as diagnostic
version `4594e66d-325b-455c-963a-ea0157a383ab`. A live rollback to
`15bda29d-83a5-4206-a448-4c0872bc5585` and restoration passed version readback,
private anonymous sessions, public HTML and unauthenticated Access rejection.
The mobile browser also verified the public menu, Privacy link, parameterized
sign-in email and editable form without reported page errors.

A subsequent hosted CPU profile identified visitor-identity middleware and
TanStack route matching/initialization as hot stacks. Registering the identity
provider once was tested but removed: sign-in still measured 80ms p99 and
credentialed tails did not improve. A later auth-only profile captured only idle
samples and is not evidence about authentication CPU.

The next investigation found that invalid credential checks still opened
PostgreSQL to read the release-schema marker before Better Auth rejected the
credential. Only a **completed successful schema check** is now remembered for
the last verified database connection string in an isolate. Database switches
require another check; failures retry. Concurrent cold requests keep independent
queries and physical clients. No pending query, identity, permission, session,
entitlement or customer content is cached by this optimization. Migrations
remain outside requests; this cache relies on the existing immutable release
schema contract, as Node's external-migration readiness already does.

Experiment `20258e49-ba30-4b83-bede-c488ca1ec67c` measured:

| Workload                | CPU samples / requests | CPU p50 | CPU p95 | CPU p99 |
| ----------------------- | ---------------------: | ------: | ------: | ------: |
| Invalid session cookie  |                50 / 50 |     1ms |     4ms |    40ms |
| Invalid bearer token    |                50 / 50 |     4ms |     8ms |    12ms |
| Credential-free session |                40 / 40 |     0ms |     0ms |     0ms |
| Live sign-in HTML       |              200 / 200 |     7ms |    40ms |    75ms |

Home and Privacy again produced no Worker invocations across 200 requests each.
Expected 404 routes still measured 53–56ms p99, with 397 of 400 records matched;
missing records are excluded, not counted as zero. All credential controls
returned private, uncached `null`, and no CPU-limit pages appeared in 1,140
requests. The full frontend suite passed 4,195 tests with one skipped and
unchanged 100% coverage. These improvements do not pass the cold CPU gate or
authorize production cutover.

The schema-check change was retained in `e8439856` and deployed from clean
source as `79851551-5932-4899-b512-0ca5f14ab9a3`. Its repeated 1,140-request
probe matched every dynamic invocation: invalid-cookie CPU was 3/59/60ms and
bearer CPU was 7/38/50ms at p50/p95/p99; live sign-in was 7/36/76ms. Home and
Privacy remained direct static assets, unsigned sessions remained 0ms, and no
CPU-limit pages appeared. This variability reinforces the failed cold CPU gate.
Mobile navigation and the editable parameterized sign-in form passed again. A
rollback to `15bda29d-83a5-4206-a448-4c0872bc5585` and restoration also passed
exact version readback, public HTML, private sessions and unsigned Access
rejection.

## Hybrid and shared usage

The same committed application also produced the hybrid Node/Nitro artifact.
Authenticated access to the intended Google Artifact Registry repository was
attempted and rejected with `BILLING_DISABLED`. Secret Manager access was
rejected for the same reason. Billing was kept closed as instructed; no new
Cloud Run service was deployed, and no cost, warm-latency or cold-start gate is
claimed.

The existing `atlas-api` Cloud Run service is also affected. Read-only Google
request logs on October 10 report: **"The request failed because billing is
disabled for this project."** Its health endpoint returns a Google 500 and both
Vercel and Workers entity/MCP proxies return 503. This is a separate discovery
outage, not a PostgreSQL schema failure. Billing remains closed as instructed.
Moving only the web application cannot restore searchable profiles; the existing
API needs a functioning host while preserving its data, routes, authentication
and discovery jobs.

Cloudflare now documents
[Python Workers with Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/python-workers/),
including psycopg and compatibility dates from September 8, 2026, and
[FastAPI support](https://developers.cloudflare.com/workers/languages/python/packages/fastapi/).
Those are possible compatibility leads for hosting the existing API without
Google billing, not evidence that Atlas's dependencies, startup, background jobs
or Free CPU gate pass. No API port or replacement API deployment is claimed
here.

Cloudflare's account dashboard showed 191 requests today out of 100,000 and 191
requests for October 1–10 at the time observed, after the initial diagnostic
load. This is not a complete 14-day shared-usage export. The SQL catalog and
logs are accessible through `cf`, but absence of retained logs does not prove
absence of requests from other Workers.

## Recovery and remaining release work

The private diagnostic evidence is under ignored `.atlas/web/`, including
initial and post-migration probes, performance measurements, before/after
database counts and browser captures. Never commit the runtime files, Access
credentials, provider logs or raw live-tail data.

A live exact-version rollback passed: version
`74cec09c-0c24-444e-b0c7-dd7d6511c014` was rolled back to
`d8870302-2849-44ee-b346-6900de6c35ca`, then restored. Each step verified the
expected version at 100% traffic and an unsigned session response of HTTP 200,
`null`, and `private, no-store`. An earlier attempt across differing
introspection-URL secret values was rejected by Cloudflare; no force override
was used. The passing test uses identical runtime settings. It does not
establish a production rollback between distinct release Workers, preserve
existing browser sessions by itself, or replace the required real-user journeys.

After the CPU fixes, the clean-source diagnostic was rolled back from
`15bda29d-83a5-4206-a448-4c0872bc5585` to
`dd6a96e8-c616-40bc-9f7b-00516ad2cc44`, then restored. Each version was verified
at 100% traffic and returned the expected private, uncached `null` session. The
restored hostname still returns 403 without its Access service token. This is
another diagnostic rollback check, with the same production acceptance
limitations above.

## Credential recovery

The operator authorized recovering credentials from their providers and creating
replacements where necessary. The existing production Stripe webhook signing
secret was recovered from Stripe's authenticated Rebuilding America dashboard,
without rotation. A signature-only request using an unhandled diagnostic event
type returned 200 from Vercel; its invalid-signature control returned 400. The
probe does not exercise checkout or entitlement changes and creates no customer,
subscription or payment. The recovered secret was saved privately and synced to
the GitHub **production** environment as `STRIPE_WEBHOOK_SECRET`; secret-name
and update-time readback succeeded. Production routing and webhook configuration
remain unchanged.

The local Stripe CLI's Rebuilding America test credential authenticates. Its
existing metadata reconstructed the test catalog without creating or changing
prices: four products, nine active prices and four Pro discount coupons. The
repository's `stripe:verify:ci` command validated that recovered catalog against
Stripe. Test credentials were not installed in the production-backed diagnostic.
The saved live CLI credential returns 401. Recovery of a live application key
requires Stripe's additional verification. Two dashboard attempts failed; the
second displayed a provider error advising another authentication option or a
later retry. No broader replacement key was created or deployed.

The existing live webhook subscribes to four events, while the repository's
billing contract requires eight, including asynchronous checkout outcomes and
refund updates. This mismatch needs resolution and deployed billing validation
before release; preserving the signing secret alone does not pass that gate.

Before cutover, finish recovering and validating the production runtime,
complete account usage and cost evidence, resolve the API failure, and obtain a
candidate that passes the approved performance and product journeys. Then
complete 24 hours of successful protected staging operation, canonical cutover
and production readbacks, replacement rollback verification, and 72 hours of
production observation. Atlas and `rap-website` share the Vercel subscription;
the recurring charge cannot be reported as eliminated until that dependency is
cleared and cancellation/downgrade is verified.
