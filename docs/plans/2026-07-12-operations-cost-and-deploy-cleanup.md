# Operations Cost and Deploy Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Keep Atlas staging and production deploys turnkey while preventing
cloud image, revision, and CI build-minute waste from silently accumulating.

**Architecture:** Treat operations cleanup as product reliability work:
bootstrap creates durable guardrails, deploy workflows enforce them before
expensive work starts, and docs explain the normal path without making operators
reverse-engineer provider dashboards. Artifact Registry cleanup handles
unreferenced image storage; Cloud Run revision pruning handles images still
pinned by inactive revisions.

**Tech Stack:** GitHub Actions, Turborepo, Google Cloud Run, Artifact Registry,
gcloud, Vercel, Node.js deploy scripts, bootstrap TypeScript phases.

---

## Current Verified State

- Artifact Registry cleanup policies are installed for
  `rap-atlas-prod/atlas-images`.
- The safe one-time cleanup was run on July 12, 2026:
  - `atlas-api` image records went from 216 to 29 during this cleanup.
  - After refreshing Cloud Run revision references, Artifact Registry had `0`
    atlas-api digests that were unreferenced by Cloud Run revisions.
- The remaining storage risk is inactive Cloud Run revisions pinning old images.
  Deleting more images directly is not the right next move until no-traffic
  revisions are pruned first.

## Task 1: Add Cloud Run Revision Retention

**Files:**

- Modify: `scripts/deploy/cloud-run-release.mjs`
- Test: `scripts/deploy/cloud-run-release.test.mjs`
- Modify: `.github/actions/deploy-atlas-api/action.yml`
- Modify: `docs/standards/cloud-costs.md`

**Step 1: Write a test for revision classification**

Add a focused test that feeds sample `gcloud run revisions list --format=json`
output into a pure helper. The helper must keep:

- every revision currently receiving traffic;
- the latest ready revision;
- the newest N inactive revisions for rollback;
- any revision created less than 24 hours ago.

Expected output: older no-traffic revisions are returned as delete candidates.

**Step 2: Implement the pure helper**

Keep the policy in code next to the deploy script, for example:

```js
const CLOUD_RUN_REVISION_RETENTION = {
  keepInactiveCount: 5,
  keepYoungerThanHours: 24,
};
```

Do not hardcode revision names. Classify by revision JSON fields.

**Step 3: Add a dry-run command**

Extend `scripts/deploy/cloud-run-release.mjs` with:

```bash
node scripts/deploy/cloud-run-release.mjs prune-revisions --dry-run
```

The dry-run should print retained and prunable revisions in the GitHub step
summary and to stdout.

**Step 4: Add the apply command**

Add:

```bash
node scripts/deploy/cloud-run-release.mjs prune-revisions
```

It must call `gcloud run revisions delete <revision> --region <region> --quiet`
only for no-traffic candidates. If any delete fails, fail the step with a
readable summary.

**Step 5: Wire it into API deploys**

In `.github/actions/deploy-atlas-api/action.yml`, run revision pruning after
hosted deploy summary succeeds. Keep it after deploy, not before deploy, so
rollback options remain intact if the new revision fails.

**Step 6: Verify**

Run:

```bash
pnpm exec node --test scripts/deploy/cloud-run-release.test.mjs
pnpm run deploy:test
```

Expected: tests pass and the deploy test suite covers dry-run behavior without
calling live gcloud.

**Step 7: Commit**

Commit:

```bash
git restore --staged .
git add scripts/deploy/cloud-run-release.mjs scripts/deploy/cloud-run-release.test.mjs .github/actions/deploy-atlas-api/action.yml docs/standards/cloud-costs.md
git commit -F -
```

Commit message:

```text
chore(dx): Prune inactive Cloud Run revisions

Atlas deploys now retire old no-traffic API revisions after a successful release, which keeps Artifact Registry cleanup effective without removing active rollback targets.
```

## Task 2: Make Artifact Storage Auditable in CI

**Files:**

- Modify: `scripts/deploy/cloud-cost-policy.mjs`
- Modify: `scripts/deploy/cloud-cost-policy.test.mjs`
- Modify: `scripts/deploy/cloud-cost-preflight.mjs`
- Modify: `docs/standards/cloud-costs.md`

**Step 1: Add a storage posture test**

Test that repository size above the policy budget is a warning, not a deploy
blocker, and that missing cleanup policy remains a blocker.

**Step 2: Add a clearer warning**

Update the warning to say whether the likely cause is:

- missing cleanup policy;
- cleanup policy in dry-run;
- inactive Cloud Run revisions pinning image digests;
- unknown, with a command to inspect.

**Step 3: Add the inspect command**

Add a read-only preflight command:

```bash
node scripts/deploy/cloud-cost-preflight.mjs inspect-images
```

It should summarize:

- total Artifact Registry atlas-api image records;
- Cloud Run-referenced digests;
- unreferenced digests;
- inactive Cloud Run revisions by service.

**Step 4: Verify**

Run:

```bash
pnpm exec node --test scripts/deploy/cloud-cost-policy.test.mjs
pnpm run deploy:test
```

Expected: tests pass without needing live GCP credentials.

**Step 5: Commit**

Commit the cost preflight changes with a `chore(dx)` message tied to preventing
hidden deploy spend.

## Task 3: Keep CI Cheap Without Hiding Real Risk

**Files:**

- Modify: `scripts/ci/changed-surfaces.mjs`
- Test: existing changed-surfaces tests if present, otherwise add
  `scripts/ci/changed-surfaces.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy-staging.yml`

**Step 1: Audit current path classification**

Confirm the current behavior for docs-only, bootstrap-only, deploy-script-only,
app-only, api-only, and global dependency changes.

**Step 2: Add tests only for enduring behavior**

Add tests for the classifier decisions that prevent expensive work:

- docs-only changes skip API deploy and hosted smoke;
- deploy action changes run deploy-script tests and hosted smoke;
- API code changes deploy staging API;
- production profile forces the full gate.

Do not test formatting, literal output labels, or incidental shell text.

**Step 3: Tighten workflow work**

Keep staging as the default continuous integration path on `main`, but avoid
duplicating standalone CI. Production remains tag-gated.

**Step 4: Verify**

Run:

```bash
pnpm exec node --test scripts/ci/changed-surfaces.test.mjs
pnpm run actionlint
```

Expected: classifier behavior is covered and workflows lint cleanly.

**Step 5: Commit**

Commit with a `chore(dx)` message about reducing wasted CI minutes while
preserving staging confidence.

## Task 4: Make Bootstrap Own the Cloud Setup End-to-End

**Files:**

- Modify: `scripts/bootstrap/phases/infra-cloud.ts`
- Modify: `scripts/bootstrap/phases/infra-project.ts`
- Modify: `scripts/bootstrap/phases/deploy.ts`
- Modify tests only for stable bootstrap behavior
- Modify: `docs/deployment/README.md`
- Modify: `docs/deployment/production.md`
- Modify: `docs/deployment/staging.md`

**Step 1: Add preflight recovery guidance**

Before build/deploy, bootstrap should detect:

- Docker installed but not running;
- gcloud account needing reauthentication;
- Cloud Build service account missing storage access;
- Cloud Run service absent before domain or edge setup;
- Artifact Registry cleanup policy missing.

Each blocked state should offer a direct recovery path. Use Cloud Build only
when local Docker is unavailable and gcloud auth is valid.

**Step 2: Keep bootstrap idempotent**

Every cloud setup step should be safe to rerun. Existing resources should be
verified and summarized, not skipped silently.

**Step 3: Verify**

Run the targeted bootstrap tests:

```bash
pnpm exec tsx --test scripts/bootstrap/lib/cold-start.test.ts scripts/bootstrap/phases/infra-project.test.ts scripts/bootstrap/phases/deploy.test.ts
```

Then run the real read/write operator check:

```bash
pnpm bootstrap --infra --yes
```

Expected: the infra phase completes without manual dashboard work.

**Step 4: Commit**

Commit with a `chore(dx)` message about making cloud setup recoverable.

## Task 5: Document the Operator Model in One Place

**Files:**

- Modify: `docs/deployment/README.md`
- Modify: `docs/deployment/staging.md`
- Modify: `docs/deployment/production.md`
- Modify: `docs/standards/cloud-costs.md`
- Modify: `AGENTS.md`

**Step 1: Document the default deploy model**

State plainly:

- `main` is continuous staging.
- Production is promoted by `v*` release tags.
- Vercel production domains are not auto-assigned from every `main` push.
- GitHub OIDC is used for cloud authentication where supported.
- Vercel CLI production deploys still need the repo-supported authentication
  path unless Vercel exposes a turnkey replacement.

**Step 2: Document automated-first operations**

Add the repo rule: any cloud or engineering setup that can be automated and made
turnkey must be automated; manual steps are fallback only.

**Step 3: Document cost cleanup**

Explain:

- Artifact Registry cleanup removes unreferenced images.
- Cloud Run revisions can pin old images.
- Revision pruning is the normal way to free the remaining image storage.
- The operator command for inspection is the read-only source of truth.

**Step 4: Verify docs**

Run:

```bash
pnpm run docs:validate
pnpm run docs:broken-links
```

Expected: docs validate and links resolve.

**Step 5: Commit**

Commit with a `docs(dx)` message about making deploy and cost operations
discoverable.

## Task 6: Final Live Verification

**Files:**

- No file changes unless verification exposes a real bug.

**Step 1: Run local focused checks**

Run:

```bash
pnpm run deploy:test
pnpm run actionlint
```

**Step 2: Run cloud read-only checks**

Run:

```bash
GCP_REGION=us-central1 \
IMAGE_REGISTRY=us-central1-docker.pkg.dev/rap-atlas-prod/atlas-images \
SERVICE_NAME=atlas-api \
node scripts/deploy/cloud-cost-preflight.mjs check
```

Then run the new image inspection command from Task 2.

**Step 3: Run bootstrap infra**

Run:

```bash
pnpm bootstrap --infra --yes
```

**Step 4: Confirm git shape**

Run:

```bash
git status --porcelain=v1 -b
git rev-list --left-right --count origin/main...HEAD
git rev-list --merges --count origin/main..HEAD
```

Expected:

- no unrelated work staged;
- no accidental merge commits;
- only owned commits ahead.

**Step 5: Push after checks pass**

Push only after the verification commands above pass and the user has not asked
to keep the work local.
