# Cloudflare publication

Recover the directory, customer accounts, purchases and protected platform
administration using the existing PostgreSQL and PDS identities. A successful
source build does not establish that production has recovered.

## Authentication

Run publication through the protected Deploy Production or Deploy Staging
workflow. The Linux runner receives existing credentials explicitly from its
GitHub environment. Publication refuses missing credentials before invoking a
provider command; it never discovers local profiles or reads macOS Keychain. Do
not run authentication helpers on the workstation to repair a CI failure.

The general publisher reads account subscriptions, Hyperdrive, Access
applications, Worker deployments and Durable Object namespaces before writes.
Its configured credential must already permit those operations. The separate
admin token has only Workers Scripts Edit and Workers Routes Edit. It cannot
satisfy the general publisher's prerequisite reads. Missing permission is a
release blocker, not permission to widen a token or skip verification.

Use an account-owned token for the publisher. Doctor reports only its format
category and a closed set of CLI failure categories, without token material or
raw provider errors. An invalid scannable format can identify an incomplete CI
save; authentication, permission, process and JSON errors require different
repairs. This keeps recovery actionable while protecting customer identities and
deployment credentials.

## Required retained configuration

The read-only `doctor` operation reports missing settings and provider access
without printing values. Source checks run locally; publication performs the
credentialed deployment and hosted checks. Production requires a release tag
whose source has already landed on main; staging accepts main or a release tag.

The environment must identify its Cloudflare account and zone, production
Hyperdrive configuration, protected API operations hostname, existing Access
service identity, and retained native wheel build run. Runtime settings come
from the protected GitHub environment or its complete private runtime export.
Missing settings fail explicitly. The publisher no longer reads Vercel, and its
workflow no longer receives Vercel credentials.

Preserve the existing public origin, authentication audiences, membership URL,
operator roles, signing secrets and passkey RP ID. Supply ordinary application
settings explicitly through the protected environment: `DATABASE_BACKEND`,
`ATLAS_DEPLOY_MODE`, `ATLAS_AUTH_BASE_PATH`,
`ATLAS_AUTH_API_KEY_INTROSPECTION_URL`, `ATLAS_SERVER_API_PROXY_TARGET`,
`ATLAS_DOCS_URL`, `ATLAS_EMAIL_FROM`, `ATLAS_EMAIL_PROVIDER` and
`ATLAS_PDS_PUBLIC_URL`. This keeps existing accounts, source-linked profiles,
documentation and email delivery usable across releases. Secret values remain in
environment secrets and never enter release manifests.

Read-only verification must establish that Hyperdrive points to the retained
database. A diagnostic Hyperdrive configuration being active does not prove that
it contains the production accounts or catalog.

Preserve existing Stripe catalog, webhook, portal, offer settings, enterprise
identity keys, callback credentials and PDS broker identity. Conflicting
readable values fail rather than replacing the retained value. Unreadable
provider secrets require the same existing value from the approved CI store.
Production billing verification runs before consumer activation, canonical route
promotion and web publication, even when new checkout is closed, so existing
customers retain billing controls. An empty new-sale offer allowlist is valid
only when `ATLAS_BILLING_CHECKOUT_ENABLED=false` is explicitly configured; live
catalog, webhook and portal verification still run. Missing or malformed
checkout closure cannot excuse an empty allowlist.

Only the first protected API bootstrap can precede billing recovery, after a
live read verifies that the selected API, discovery and public-edge Workers are
absent. Subsequent publications still require billing verification, because
paused consumers do not detach existing public routes. Paused verification and
rollback remain available. Bootstrap creates no canonical route or active
consumer; additive schema checks and account identity verification still run.

Billing configuration is owned by normal Atlas bootstrap, which provisions the
catalog, webhook and Atlas-specific customer portal. Production consumes the
canonical runtime settings from its protected GitHub environment. Use a
restricted live runtime key (`rk_live_`) for the application; publication
rejects unrestricted live keys before contacting Stripe. Keep the
repository-level test key and catalog for CI. No separate repair credential or
workflow is required.

## Publication sequence

Each operation retains a `cloudflare-release-TARGET-RUN_ID` artifact. Supply the
preceding completed trusted run as `source-run-id`; do not rebuild a different
artifact to stand in for a retained release. Recovery can use a failed trusted
run containing its interruption journal.

1. Run `doctor` and resolve every reported prerequisite through the existing
   approved configuration. Verify the exact retained native wheel provenance.
2. Run `publish-api` with explicit bootstrap or a retained previous release.
   This applies the additive schema and publishes the API and discovery pair
   paused. Retain the schema receipt and exact Worker/namespace identities.
3. Run `verify-api` for paused verification. In production it also proves a
   populated, source-linked directory and private-route/MCP isolation through
   the protected edge without changing public routes. Run `activate-api` only
   with fresh measured Free-plan capacity evidence and the exact durable
   consumer handoff. Activation preserves retained job ownership and permits
   only the intended release to own discovery consumers.
4. Run `promote-api` after protected health, directory, private-route and MCP
   challenge checks pass. The operation adds only the canonical API Worker route
   over the existing proxied DNS record. It retains the created route ID before
   proving public behavior. It never deletes DNS records. A verified paused pair
   can serve HTTP traffic; routing does not activate discovery consumers.
5. Run `web-candidate` for the exact verified API pair, active or paused. This
   publishes and checks the protected candidate, exercises the existing PDS,
   public API, signed-in identity and configured checkout, and deploys protected
   administration.
6. Run `promote-web` only after canonical API proof and fresh candidate
   observations. Supply `rollback-run-id` naming a successful retained
   Cloudflare production release. Its artifact, runtime and routing checks must
   pass before promotion; there is no Vercel fallback. Verify the canonical site
   and protected admin afterward.

An API upgrade preserves the original canonical route and routing journal.
Production `verify-api` also checks that exact route's ownership and public
directory behavior when a canonical route is retained. It saves a separate
`api-routing-verification.json` naming the current API, discovery and operations
versions and the original journal's digest. A replacement or consumer transition
invalidates inherited HTTP verification flags. Immediately before web promotion,
the publisher repeats the read-only canonical check; an old `publicApiState`
flag cannot authorize a new release. These checks preserve source-linked profile
URLs without deleting or recreating the API route.

The measured evidence must name the exact source, Cloudflare account and API /
discovery versions. Current daily usage alone does not prove capacity at twice
the expected load or that discovery extraction fits its execution budget.

Builds, Worker deployment and provider readbacks use the pinned official `cf`
CLI. Canonical API routing uses the official zone route API with the existing CI
token for inventory, creation and deletion of the exact retained route ID. This
is a narrow CLI limitation: `cf` 1.0.0-beta.14 exposes trigger deployment but no
route inventory or deletion command, and an empty trigger route list does not
remove existing routes. The route API preserves an exact rollback without
patching the CLI or altering DNS.

## Interruption and recovery

If the initial API upload succeeded but its callback failed before the final
identity was journaled, run `verify-api` with that failed trusted run. It checks
the retained artifact bytes, release and schema annotations, unchanged discovery
deployment and original API SQLite namespace before recording the final API
identity. It does not upload code, apply schema changes, activate consumers or
change public routing. Protected health, paused-consumer, populated directory,
source-linked profile, private-route and MCP checks still have to pass in
production, preserving existing accounts and directory data during recovery. The
current recovery source can verify an older trusted publication artifact; its
original release identity is preserved. Activation and promotion still require
their exact source identity. Publish the current paused API pair using the
verified retained run before proceeding with the current web release.

Read-only verification retains `verification-diagnostics.jsonl` with fixed
Access, domain, denial and runtime stage names and pass/fail states. Use the
failed stage to identify the next readback to investigate. Provider error text
and credential values are never copied into those diagnostics.

Use `pause-api` with the retained run to stop the exact consumer owner. If
activation from a verified paused pair was interrupted, use its failed trusted
run as `source-run-id`. The operation retains the original transition journal,
reconciles accepted uploads and restores the exact paused versions. Retries
reuse the durable recovery plan and rollback journal. Private isolation,
protected health, matching release identities and drained consumers must pass
before the pending transition is cleared. An interrupted pause from an active
pair requires explicit recovery; this path never restarts consumers implicitly.
If preflight failed before the first consumer journal, recovery makes no
deployment changes and clears pending state only after proving that the exact
original paused pair, namespaces and protected controls remain unchanged.

Use `restore-api` with the routing journal to remove only the recorded canonical
API route. The retained pair can be verified active or verified paused; its
current versions and namespaces must still match provider readback. Recovery
refuses changed ownership, duplicate matching routes or changed active versions.
It leaves DNS and unrelated routes intact. Restoring an earlier origin's route
is not proof that the earlier origin is healthy.

`restore-api` removes the original route; it does not roll back an upgraded API
runtime. The original journal remains bound to its original API pair and
operations Worker version, so a newer manifest is deliberately rejected. The
joint runtime rollback helper restores API and discovery versions while keeping
the canonical route and its operations edge in place. It does not restore the
operations Worker version. Removing the original route afterward would also
require restoring that exact original edge version before using the original
journal. Fresh canonical route proof does not establish that recovery sequence
or replace a hosted joint version rollback rehearsal.

The Roll Back Production workflow uses the retained web promotion journal and
immutable prior deployment. Never recreate a rollback snapshot from the
already-changed public hostname. The initial canonical cutover was not produced
by that promotion workflow, so its retained candidate directory is not a valid
`productionDirectory` for workflow recovery.

### Restore an existing Worker version

For that initial release, use the official `cf` deployment command to select its
known-good immutable version on the same Worker. This preserves the canonical
routing and Durable Object namespaces without rebuilding or running migrations.
Select the explicit account, auth profile, Worker and retained version. Inspect
the active deployment and target bindings before changing traffic:

```sh
pnpm exec cf workers deployments list --worker "$ATLAS_WEB_WORKER" --profile "$ATLAS_CF_PROFILE"
pnpm exec cf workers versions get "$ATLAS_WEB_ROLLBACK_VERSION" --worker-id "$ATLAS_WEB_WORKER" --profile "$ATLAS_CF_PROFILE"
```

Create a local `rollback-versions.json` with exactly one verified version:

```json
[{ "version_id": "VERIFIED_VERSION_UUID", "percentage": 100 }]
```

Then select that version and read the active deployment back:

```sh
pnpm exec cf workers deployments create --worker "$ATLAS_WEB_WORKER" --strategy percentage --versions @rollback-versions.json --profile "$ATLAS_CF_PROFILE"
pnpm exec cf workers deployments list --worker "$ATLAS_WEB_WORKER" --profile "$ATLAS_CF_PROFILE"
```

Do not use `--bypass-deployment-checks`. Stop if secrets, namespace lifecycle or
resource availability prevent rollback. A version selection does not reverse a
database migration or an independent API/discovery deployment. Verify sourced
profiles, the existing signed-in private list, anonymous denial and upstream
health after the active version readback; an accepted deployment alone is not
rollback acceptance.

On October 12, 2026, production completed a live round trip from `b88eea12` to
`26c66b20` and back to `b88eea12` on `atlas-workers-staging-f38dd103c56e`. Both
versions contained identical retained code, canonical bindings and assets.
Cloudflare restored the original version at 100% without bypass flags. Existing
session/list continuity, sourced profile rendering, API health and anonymous
private-list denial passed. This proves same-Worker version restoration; it does
not certify rollback across a schema change or a different API/discovery pair.

Artifacts are scanned against CI credentials and provider-only secrets before
upload. Captured runtime values remain in owner-only runner files until that
scan finishes, then an always-run cleanup step removes them. Browser failure
traces are encrypted using the existing hosted verifier secret and the exact
source/run/attempt identity; raw traces are excluded from uploaded artifacts.

## Acceptance

Public API promotion requires a populated directory and a matching profile with
usable source links. Hosted acceptance requires the same catalog proof and the
explicit retained public PDS URL; neither journey may silently skip.

Verify source-linked directory rows and profiles, existing account sign-in, PDS
identity, invitations, private applicant isolation, real provider delivery,
existing purchases, enabled checkout and customer billing controls. Verify the
canonical MCP audience and authenticated client behavior, old admin redirects,
protected operator access and rejection of forged or ordinary customer
credentials. Record the exact deployed artifacts, versions, namespace IDs,
schema receipt, observations and rollback result. Keep release acceptance
incomplete while any provider check or real user journey remains unproven.
