# Cloudflare API and discovery version recovery

`scripts/deploy/api-runtime-rollback.mjs` restores retained API and discovery
Worker versions together so failed releases do not leave search, profiles and
background discovery on unrelated code. It uses the new `cf` CLI through
`cloudflareCommand`; there are no Wrangler, Google or Vercel operations.

The release publisher must retain each runtime's **actual** full commit SHA,
Build Output artifact digest, Worker version ID, Worker name, SQLite namespace
ID and class. Use the publisher's immutable deployment records, not guessed
values or an evaluation report relabeled as production. The helper checks the
active provider version and SQLite namespace against those records. Cloudflare
does not return the local Build Output directory digest; the retained publisher
record owns that association with the exact immutable version.

Before replacing either runtime, capture both while their previous versions are
still active. Reuse an existing in-memory credential session:

```js
import {
  captureApiRuntimeSnapshot,
  createApiRollbackPlan,
  restoreApiRuntimeSnapshot,
} from "./scripts/deploy/api-runtime-rollback.mjs";

const snapshot = captureApiRuntimeSnapshot({
  accountId,
  runtimeReleases: {
    api: previousApiIdentity,
    discovery: previousDiscoveryIdentity,
  },
  env: session.env,
});
// The publisher durably saves snapshot alongside its retained release artifacts.
// After publishing, use the exact new deployment records to create the plan.
const plan = createApiRollbackPlan({
  snapshot,
  current: { api: publishedApiIdentity, discovery: publishedDiscoveryIdentity },
});
// Save plan before changing production routing. This check performs no writes.
await restoreApiRuntimeSnapshot({ plan, env: session.env });
```

Recovery uses the publisher's atomic private JSON journal writer and a real
hosted journey probe. Persist checkpoints before acknowledging them; retain the
plan and latest journal on every failure:

```js
const report = await restoreApiRuntimeSnapshot({
  plan,
  journal: retainedJournal, // Omit for a new operation.
  env: session.env,
  apply: true,
  checkpoint: savePrivateJournalAtomically,
  probe: probeRestoredHostedJourneys,
});
```

`probeRestoredHostedJourneys({ accountId, runtimeReleases })` must exercise the
restored deployment and return `{ status: "pass", evidenceReference }` only
after successful real checks. Provider readback alone never substitutes for
working product journeys. The helper reads both runtimes again after the probe
to detect a concurrent deployment.

The plan hashes its complete previous/current identities and captured snapshot.
Recovery refuses unrelated active versions, missing retained versions, split
traffic, mismatched journals and namespace changes before its first write. It
restores discovery before the API, reads back each mutation, and resumes a lost
provider response from actual provider state without replaying completed writes.
It never deletes a Worker, version, namespace or database record, and never
bypasses Cloudflare's deployment checks, including checks after secret changes.

This is a **version** rollback. It requires backward-compatible PostgreSQL and
Durable Object state, and does not reverse database migrations or make the two
provider updates atomic. Worker/namespace migrations require a separate retained
data-aware recovery plan. An error after one update leaves the exact journal for
explicit recovery; it does not pretend both runtimes were restored.

The returned `runtimeReleases` contains API and discovery only. It does not
claim web routing recovery or satisfy the full joint web/API/discovery evidence
gate by itself. Production publishing still needs a dedicated eligible API and
discovery manifest, Cloudflare-only web routing recovery, and a complete joint
rehearsal. The diagnostic Python publisher remains ineligible for production. No
staging or observation waits are introduced by this helper.
