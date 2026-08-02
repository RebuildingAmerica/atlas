# CI Cache Resource Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route routine CI tests by changed surface and make the GitHub Actions
Turbo cache reusable without parallel-write races.

**Architecture:** Keep one required test job and branch inside it from the
classifier's existing outputs. Use GitHub Actions as the only active remote
cache transport, with deterministic per-job keys and branch restore prefixes.

**Tech Stack:** GitHub Actions, Turborepo 2.10.3, pnpm 11.10.0, Node test runner

## Global Constraints

- Production releases run the full test graph.
- App-only runs include the app and its Turbo dependency graph but no Python
  test suites.
- App-only runs explicitly include the independent `entity-widgets-mcp` package.
- Python-only runs use the existing `python:test` package selectors.
- CI must not send the rejected Vercel remote-cache credential.

---

### Task 1: Lock the workflow contract

**Files:**

- Create: `scripts/ci/cache-workflow.test.mjs`

**Interfaces:**

- Consumes: `.github/workflows/ci.yml` and
  `.github/actions/setup-toolchain/action.yml` as deployment-policy artifacts.
- Produces: executable assertions for routing, cache keys, and remote-cache
  authentication.

- [ ] **Step 1: Add failing workflow assertions**

Assert that both surfaces select `turbo run test`, Python-only selects the four
existing Python task selectors, app-only selects
`--filter='@rebuildingamerica/atlas-app...'`, cache keys contain `github.job`
and `github.sha`, and workflow files contain no `TURBO_TOKEN` or `TURBO_TEAM`.

- [ ] **Step 2: Prove the assertions fail before implementation**

Run: `node --test scripts/ci/cache-workflow.test.mjs`

Expected: routing, cache-key, and remote-auth assertions fail against the
current workflow.

### Task 2: Implement surface routing and cache isolation

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy-staging.yml`
- Modify: `.github/workflows/deploy-production.yml`
- Modify: `.github/actions/setup-toolchain/action.yml`

**Interfaces:**

- Consumes: `RUN_PYTHON_TESTS`, `RUN_APP_TESTS`, and `TURBO_AFFECTED_FLAG` from
  the classifier job.
- Produces: one test job whose selected command matches the changed surface and
  one cache writer per GitHub job.

- [ ] **Step 1: Branch the test command by classifier output**

Use a both/Python/app conditional. Preserve `affected_args` only on direct Turbo
invocations and retain the full command when both outputs are true.

- [ ] **Step 2: Isolate and stabilize cache keys**

Replace `github.run_id` with `github.job` plus `github.sha`, and include the job
name in restore prefixes.

- [ ] **Step 3: Remove rejected remote-cache credential injection**

Remove the reusable-workflow secret declaration, global Turbo credential
environment, and caller secret forwarding. Keep `TURBO_TELEMETRY_DISABLED=1`.

- [ ] **Step 4: Run focused verification**

Run:
`node --test scripts/ci/cache-workflow.test.mjs scripts/ci/changed-surfaces.test.mjs scripts/ci/turbo-graph-contract.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Validate workflow syntax and selectors**

Run: `pnpm run actionlint && pnpm run turbo:validate`

Expected: both commands exit successfully.

### Task 3: Verify the hosted identity hydration fix

**Files:**

- Modify: `app/tests/e2e/atproto-identity-hosted.spec.ts`

**Interfaces:**

- Consumes: Playwright's `networkidle` navigation readiness.
- Produces: a hosted identity proof that cannot fill the SSR-controlled field
  before React attaches its change handler.

- [ ] **Step 1: Use observable hydration readiness**

Navigate to the final sign-in page with `waitUntil: "networkidle"`, matching the
established acceptance helper.

- [ ] **Step 2: Run formatting, lint, and targeted test discovery**

Run:
`pnpm --filter @rebuildingamerica/atlas-app exec prettier --check tests/e2e/atproto-identity-hosted.spec.ts && pnpm --filter @rebuildingamerica/atlas-app exec eslint tests/e2e/atproto-identity-hosted.spec.ts`

Expected: both commands pass; the live hosted proof will run after the next
deployment.
