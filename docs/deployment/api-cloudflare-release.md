# Paused Cloudflare API and discovery releases

The production publisher keeps people browsing the directory on an identified,
recoverable API version. It does not run migrations in an HTTP request, start
consumers, or change the public web route. Evaluation Workers and their reports
remain evaluation only.

`pnpm api:release-cloudflare` builds the production entrypoints, deploys a
paused API/discovery pair, reads back the exact active versions and SQLite
namespaces, and probes the real protected runtimes. Its output has
`productionEligible: false`: the separate consumer handoff and joint web
functional, performance, memory outcome, Free quota and rollback gates still own
production acceptance. There is no invented staging/observation duration or paid
fallback.

## Database release job and doctor

Supply an existing private runtime JSON file containing `DATABASE_URL`. The file
must be regular and owner-only (`0600`); no database URL is passed in argv or
written into the result. The command requires a clean committed checkout and an
exact full commit SHA. Use a separate release-job process with direct PostgreSQL
connectivity, never a Worker request or alarm.

```sh
pnpm api:schema-release --config-file /private/atlas-runtime.json \
  --release-sha FULL_COMMIT_SHA --output .atlas/releases/RELEASE/schema-doctor.json

pnpm api:schema-release --config-file /private/atlas-runtime.json \
  --release-sha FULL_COMMIT_SHA --output .atlas/releases/RELEASE/schema-receipt.json \
  --apply
```

Without `--apply`, the transaction is read-only and a missing receipt returns
`status: missing`; it never creates a table or runs a migration. `--apply` takes
a transaction-scoped advisory lock, rejects a concurrent release job without
waiting, invokes the existing ATProto migration and complete PostgreSQL schema,
and commits the schema and immutable receipt together. PostgreSQL statements
have a bounded 300-second timeout. Receipt identities include the commit, schema
and migration source digests, a credential-free database identity digest, and
the catalog digest. The same release is idempotent; source or catalog drift
fails explicitly. This uses the existing application schema and a separate
`public.atlas_schema_releases` receipt table.

A failed job rolls its transaction back. No command reverses schema/data changes
for an older runtime. Retained versions must be compatible with the committed
schema and existing Durable Object state before promotion or rollback.

## Publish a candidate pair

Prepare the reviewed native wheels/vendor using the existing package tooling.
Supply its retained `api-provenance.json` and the **latest** package archive
provenance from the current partition operation. The offline verifier checks
locked native versions/wheel hashes, installed native extension bytes, both
archive/file inventories, and Atlas code/resources against the current checkout.
It fails if source was changed without rebuilding the vendor. No native build,
GitHub download, credential lookup, or dependency upgrade is hidden in
publishing.

Use an existing private retained API service JSON dump for
`--api-settings-file`, the same format accepted by the evaluation publisher.
`--runtime-file` contains the explicit web/database/auth identities;
`--access-file` contains the existing Access service token ID/client ID/client
secret. All three files are owner-only. Hyperdrive must match that PostgreSQL
origin with query caching disabled. The Cloudflare account must remain Workers
Free.

The retained API configuration must use distinct app-signing, callback and
visitor-origin credentials. Only the callback and visitor-origin credentials
belong in the API export; remove `ATLAS_AUTH_INTERNAL_SECRET` and the retired
`ATLAS_OPERATOR_ALLOWED_EMAILS` there. Preserve the instance and platform
operator lists and all declared machine issuers.

Consumer authority comes from the deployment's explicit
`ATLAS_ACTIVE_RELEASE_SHA` text binding. Publication always emits the empty
string, which pauses the exact release regardless of previously enabled durable
state. Activation is a separately gated Cloudflare deployment setting that
binding to the exact release SHA. No API token, new issuer scope, shared signing
secret, or HTTP mutation grants consumer authority.

The binding-only `GET /__atlas/consumers` readback drains the complete current
alarm unit, reconciles the deployment's desired state durably, then deletes a
paused alarm or arms enabled retained receipts. Other methods return 405. The
public Worker rejects all requests; the operations edge remains behind Access.
Pause and activation deployments must retain their own exact Worker version,
artifact and rollback identities, and reject readbacks for an older version.
Real Durable Object rollout/cancellation proof remains a hosted acceptance gate;
local lock tests do not establish provider update behavior.

```sh
pnpm cf:session -- node scripts/deploy/api-cloudflare-release.mjs \
  --target staging \
  --directory .atlas/api-releases/FULL_COMMIT_SHA/staging \
  --runtime-file /private/atlas-runtime.json \
  --api-settings-file /private/retained-api-service.json \
  --access-file /private/atlas-access.json \
  --schema-receipt .atlas/releases/RELEASE/schema-receipt.json \
  --vendor .atlas/python-api-dependencies \
  --native-provenance .atlas/python-native-evaluation/RUN/api-provenance.json \
  --packages-provenance /private/current-packages-provenance.json \
  --hyperdrive-id HYPERDRIVE_ID --zone-id ZONE_ID \
  --operations-hostname atlas-api-ops-staging.atlas.rebuildingus.org \
  --bootstrap --apply
```

Omit `--apply` for validation/read-only preflight. A missing operations Access
application is provisioned only with `--apply`, using the existing service token
and one exclusive policy; policy readback precedes attaching its route. The
Python Workers themselves have no domains, workers.dev, or preview URLs. The
separate operations Worker accepts GET only, is protected by Access, and binds
the `application` objects with the explicit best-effort `enam` location hint on
first creation to keep database round trips near the retained us-east database.
It cannot POST consumer controls. Anonymous Access denial is tested on
deployment.

First deployment explicitly requires `--bootstrap` and both Worker names to be
absent. It publishes a paused, nonpromotable API seed without the
not-yet-existing discovery binding, then discovery, then the final fully bound
API. The seed's exact artifact/version/namespace is retained in the journal. It
never enables work. All final outputs require both role bindings. No prior
rollback version is invented for bootstrap; the verified new pair becomes the
retained baseline.

For an existing deployment, replace `--bootstrap` with
`--previous-release /path/to/retained/api-release.json`. Both retained versions,
SQLite namespaces, release markers and paused consumer controls must read back
before any new upload. The publisher snapshots the old pair before the first
write and saves a joint rollback plan after each new runtime readback. A
version's provider tag is the full commit; its provider message records the
exact artifact and schema receipt digests. Those immutable version readbacks
join to the final artifact bytes without embedding a recursively self-changing
digest in the artifact.

## Results, recovery and consumer handoff

The release directory retains:

- `api-release.json`: exact `runtimeReleases.api` and `.discovery`, account,
  source commit, schema receipt digest, package/native provenance, real probe
  outcomes, retained snapshot and joint rollback plan.
- `release-journal.json`: intent before each deployment, each confirmed
  readback, seed identity if applicable, and verification-required state on
  failure.
- `api-rollback-plan.json`: the existing rollback helper's exact saved plan when
  replacing a retained pair.
- `api/`, `discovery/`, `bootstrap-api/` when applicable, and `operations/`:
  actual Build Output artifacts. Settings secrets stay outside these artifacts
  and are removed from the owner-only temporary secrets file after the cf child
  exits.

A failed real probe never yields a verified release. If both final versions
uploaded and only verification needs retrying, run the same command with
`--verify-only`; only target, directory, runtime/settings/Access files,
operations hostname and zone are required. It uses retained immutable identities
and fresh provider readbacks/probes, without rebuilding, redeploying or
activating work. A partial upload requires reviewing the saved journal and
explicit recovery using [the joint rollback helper](api-runtime-rollback.md);
there is no blind replay. Keep each release directory rather than overwriting an
earlier journal.

A successful result means `verified-paused`, not end-to-end production
acceptance. The protected probes cover `/__atlas/release`, Access-protected
binding-only GET `/__atlas/consumers` and `/health` for both roles. Full
directory/search/import, source provenance, MCP, bounded discovery/Firehose
delivery, performance, provider memory outcomes and doubled shared-account quota
checks remain the joint release gates. Only a separately authorized deployment
may set the exact active release SHA, after legacy workers/schedulers have
handed off ownership. Activation and pause require fresh exact-version readbacks
and retained rollback identities. Public web routing must reject all
`/__atlas/*` control paths.

The reusable `publishApiRelease`, `verifyPausedApiRelease`, and
`deployReleaseArtifact` APIs accept the caller's session environment. They never
load Keychain or refresh credentials. Use the
[session wrapper](cloudflare-session.md) or a retained in-memory
`createCloudflareSession()` session. Expiry requires an explicit new session;
there is no automatic retry/refresh loop.

## Deploy consumer activation and pause

`pnpm api:consumers-cloudflare` changes only `ATLAS_ACTIVE_RELEASE_SHA` in
retained Build Output artifacts. The pinned `cf` deployment preserves existing
Worker secrets; this command accepts neither replacement settings nor a secret
file. This keeps existing accounts and operator authority intact while handing
background updates to Cloudflare.

Start with a read-only identity check:

```sh
pnpm api:consumers-cloudflare --mode pause \
  --manifest RELEASE/api-release.json \
  --api-artifact RELEASE/api --discovery-artifact RELEASE/discovery \
  --directory NEXT_TRANSITION
```

The command requires an explicit `CLOUDFLARE_ACCOUNT_ID` and an existing
`CLOUDFLARE_API_TOKEN` supplied by the authorized deployment environment. It
never opens Keychain, loads a CLI profile or starts authentication. Without
`--apply`, it checks retained artifact bytes, exact active versions, annotations
and SQLite namespaces without publishing, reconciling consumers or creating
output directories.

For a deployment, add
`--apply --access-file ACCESS_FILE --operations-hostname HOSTNAME --zone-id ZONE_ID`.
The Access file must be an owner-only regular file holding the existing scoped
service credentials. The operations host and its exclusive Access policy must
match the retained release; anonymous requests must be rejected before any
runtime deployment.

Private validation activation uses
`--mode activate --preflight PREFLIGHT_JSON --ownership HANDOFF_JSON`. Preflight
must pass the existing shared Free quota, baseline and cost checks for this
account and release. The live API/discovery Workers must have no public domains
or routes, and their operations host must remain protected by the existing
exclusive Access service policy. Handoff evidence must name `accountId`,
`releaseSha`, `verifiedAt`, `legacyWorkersStopped: true`,
`legacySchedulersStopped: true` and an `evidenceReference`. It expires after ten
minutes. These records document real verification; writing a record is not a
substitute for stopping the legacy consumers or measuring the deployed
application.

Activation publishes API then discovery; pause publishes discovery then API.
Each operation retains new artifacts, exact version identities, the original
snapshot and a namespace-preserving rollback plan in `consumer-journal.json` and
`api-release.json`. Both roles must return the exact desired release and
consumer state through protected GET probes before `verified-active` or
`verified-paused` is recorded. Activation does not claim production acceptance;
the new exact versions still require hosted acceptance before public cutover.
The sequence is paused publication, private routing/Access and rollback
verification, legacy consumer handoff, private activation, then real discovery,
product journeys, load and rollback measurements on the resulting active version
pair. Those exact active versions must pass `assessWebRelease` and the existing
promotion gates before public cutover. This ordering permits real alarm
measurements without requiring a paused consumer to prove work it cannot
execute.

Do not replay a failed or interrupted transition. Its atomically replaced
journal records confirmed partial writes and the uncertain upload intent before
each provider write. Once provider reads work, reconcile uncertainty without
deploying or activating anything:

```sh
pnpm api:consumers-cloudflare \
  --reconcile-journal NEXT_TRANSITION/consumer-journal.json \
  --output NEXT_TRANSITION/reconciled-for-rollback.json
```

Reconciliation verifies retained bytes and exact annotations, refusing unrelated
versions. It produces a current rollback plan for
[the existing joint rollback helper](api-runtime-rollback.md), while keeping
status `verification-required`. Only real protected probes can prove that work
has drained or that a production journey has recovered.
