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
acceptance. The protected probes cover `/__atlas/release`, authenticated GET
`/__atlas/consumers` and `/health` for both roles. Full directory/search/import,
source provenance, MCP, bounded discovery/Firehose delivery, performance,
provider memory outcomes and doubled shared-account quota checks remain the
joint release gates. Only the separately authorized handoff action may POST
`/__atlas/consumers` with the existing internal secret and exact release SHA,
after legacy workers/schedulers have handed off ownership. Public web routing
must reject all `/__atlas/*` control paths.

The reusable `publishApiRelease`, `verifyPausedApiRelease`, and
`deployReleaseArtifact` APIs accept the caller's session environment. They never
load Keychain or refresh credentials. Use the
[session wrapper](cloudflare-session.md) or a retained in-memory
`createCloudflareSession()` session. Expiry requires an explicit new session;
there is no automatic retry/refresh loop.
