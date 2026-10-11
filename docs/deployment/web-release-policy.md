# Immediate Cloudflare cutover policy

The operator authorized Cloudflare-only hosting with the web and Python API in
SQLite-backed Durable Objects and explicitly waived the original 24-hour staging
and 72-hour production observation waits. This policy protects search,
source-linked profiles, existing sign-in credentials, paid workspaces, and
discovery by retaining actual functional, performance, Free quota, and rollback
checks. It does not declare the current hosted release healthy.

An evidence file can record that instruction using this object. Use the actual
operator identity, instruction reference, timestamp, and the full committed SHA
being released; these fields are an audit record, not an authorization token or
human verification system.

```json
{
  "releaseSha": "<full 40-character commit SHA>",
  "releasePolicy": {
    "mode": "immediate",
    "architecture": "cloudflare-durable",
    "releaseSha": "<same full commit SHA>",
    "authorizedBy": "<operator>",
    "authorizationReference": "<reference to the real instruction>",
    "authorizedAt": "<actual instruction timestamp in ISO 8601>"
  }
}
```

Without this explicit policy the staging and production observation commands
continue to require their original windows. Cloud Run is no longer selectable as
a fallback. The diagnostic `web:durable-evaluate` command remains ineligible for
production; use the normal release commands below to build a real candidate.

## Measured evidence

`web:assess` reads `scripts/deploy/web-assess.mjs`. Immediate mode requires:

- A real 14-day baseline, ending within 48 hours, with `warmP95Ms`.
- `cloudflare.accountId`, `plan: "free"`, `collectedAt`, and a private
  `evidenceReference` to the provider quota inventory. Under
  `cloudflare.quotas`, each dimension has measured `candidate` and
  `otherAccountUsage` values. The dimensions are `workersRequestsPerDay`,
  `durableRequestsPerDay`, `durableGbSecondsPerDay`, `durableRowsReadPerDay`,
  `durableRowsWrittenPerDay`, `durableStorageBytes`, and
  `hyperdriveQueriesPerDay`. Doubled candidate usage plus other account usage
  must stay strictly below 80 percent of each Free allowance. Include retries,
  alarms, SQLite metadata, cold starts, active object duration, and all other
  account projects in the forecast; do not count one shared allowance twice.
- `durable.journeysPassed: true`, measured `warmP95Ms` no more than 20 percent
  above baseline, `coldP95Ms` at most 3000, and routing Worker `edgeCpuP99Ms`
  below 8 with `edgeCpuLimitFailures: 0`. Complete hosted journeys remain
  separate from read-only page probes.
- Zero added costs in `durable.addedMonthlyCosts`: `databaseUsd`, `networkUsd`,
  `buildsUsd`, `storageUsd`, and `logsUsd`. Existing retained database and
  identity services do not become newly allocated free allowances.
- `durable.runtimeReleases.web`, `.api`, and `.discovery`. Each identity records
  `workerName`, `releaseSha`, `workerVersionId`, `artifactDigest`,
  `namespaceId`, `namespaceClass`, and `storage: "sqlite"`. API and discovery
  may share the same Worker and namespace when that is the actual deployed
  architecture. The web identity must match the staged candidate, including its
  `AtlasAppRuntime` namespace. Dependencies are pinned in the manifest; source
  SHA alone cannot identify a deployed runtime.
- `durable.measurements.web`, `.api`, and `.discovery`, each repeating its exact
  runtime identity and recording `provider: "cloudflare"`, `evidenceReference`,
  and `collectedAt` within the last ten minutes. Each requires `cpuP99Ms` below
  the default 30000ms object CPU limit, `peakConnections` at most six,
  `limitFailures: 0`, and `bundleStartupPassed: true`.
- Memory acceptance uses real hosted load outcomes:
  `knownMemoryLimitBytes: 134217728`, `memoryLimitFailures: 0`, and
  `providerLoad` containing `representativePassed`, `maxBoundedPayloadPassed`,
  and `concurrencyPassed`, all true, plus `scopeReference` identifying the
  exercised payload/concurrency bounds. Cloudflare does not need to expose an
  exact peak-memory metric. If `peakMemoryBytes` is supplied, it must be below
  the limit and accompanied by `memoryMeasurement: "provider"`; allocated memory
  and local heap estimates are not hosted measurements.
- Discovery additionally requires provider-observed `maxAlarmWallMs` below
  900000 and `resumableAlarmsPassed: true`. A timed-out monolithic pipeline is
  not a successful checkpoint or safe retry.
- `durable.rollback` with `readbackPassed: true`, a private `evidenceReference`,
  and `runtimeReleases` matching the exact joint web/API/discovery release under
  evaluation. Keep the retained routing snapshot and original provider releases.
  This evidence must come from the joint rollback tooling; it cannot be inferred
  from a successful build or a web-only routing check.

The checked Free limits come from Cloudflare's
[Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
and
[Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/),
checked October 10, 2026. Review those constants against provider documentation
when changing the release policy.

## Release commands

Keep evidence and credential files under ignored `.atlas/` paths with private
permissions. Use the existing `cf` authentication profile or scoped CI token;
never put credential values in evidence, manifests, Git, or command arguments.

Set `ATLAS_WEB_EVIDENCE_FILE` to the measured evidence file. The existing
runtime sync and candidate-runtime commands still preserve the original
credentials, canonical URL, passkey RP ID, and protected verifier. Prepare and
publish using:

```sh
pnpm web:prepare --target staging --architecture workers
pnpm web:publish-candidate --target staging --architecture workers --directory <candidate-directory>
pnpm web:observe --target staging --deployment <candidate-directory>/deployment.json --journal .atlas/web/staging-probes.jsonl --hours 0 --policy <evidence-file>
pnpm web:assess --target staging --evidence <evidence-file>
pnpm web:promote --target production --source <candidate-directory> --journal .atlas/web/staging-probes.jsonl --evidence <evidence-file>
```

Prepare returns a `.atlas/web/staging/<SHA>/cloudflare-durable` directory. It
uses the existing DO compiler mode internally while writing an ordinary
immutable release manifest with `execution: "cloudflare-durable"`. API/discovery
dependencies must already have valid release identities. The publisher requires
the compiled SQLite `AtlasAppRuntime` export, installs `APP_RUNTIME` and
`API_RUNTIME` bindings, and reads back upstream versions and namespaces before
and after publication.

Complete real journeys, measurements, and joint rollback verification for that
exact published candidate before assessment or promotion. The provisioning
budget check does not stand in for those later gates. A plan without `--apply`
performs no production cutover. The existing `--apply` invocation requires the
production destination, hostname, owner, project, team, provider identities, and
retained Vercel recovery credentials documented in the hosting runbook.

Promotion copies the exact staged artifacts, rechecks the current protected
journal after provisioning, verifies routing recovery, and runs immediate
canonical production probes. Failed production probes restore retained Vercel
routing. The web promotion command does not itself mutate API/discovery
versions; joint rollback must cover those separately whenever they change.

Rollback archives verify the manifest's execution mode, selected dependencies,
and operator audit against the deployment. Their report retains those identities
and the published web namespace alongside the archive digest.

Immediate summaries report `windowWaived: true`, actual `elapsedHours`, and
`currentChecksPassed`. They leave `continuousChecksPassed: false` for a
zero-hour window. The production result retains the operator policy and reports
`observationRequiredHours: 0`; it never invents historical samples or elapsed
operation. Each real probe still verifies active versions, namespaces, rendered
pages, API health, catalog profiles, anonymous identity, MCP challenges,
billing, and Access protection where applicable. Ongoing observations can be
requested explicitly with the same journal commands.
