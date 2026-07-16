# Idiomatic Turbo Package Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Make `turbo run test`, `turbo run lint`, and `turbo run typecheck`
cache and run work by behavior-owning package, so a change does not retest the
entire frontend.

**Architecture:** Keep the root Turbo configuration limited to root-owned
operations, shared global dependencies, and no service-specific task details.
Each runnable workspace owns its standard `build`, `typecheck`, `lint`, and
`test` task definitions, inputs, outputs, and environment. Move frontend
behavior into `atlas-ui`, `atlas-catalog`, and `atlas-access`; route files
remain thin application composition and server-entry adapters. Types remain
exported by the package whose runtime behavior owns them—there is no shared
types package, `types.ts` bucket, or `app/src/types` directory.

**Tech Stack:** pnpm 11, Turborepo 2.10.3, TypeScript, React 19, Vite, Vitest,
ESLint, FastAPI/pytest.

## Global Constraints

- Preserve `pnpm exec turbo run test` as the CI test command; do not hand-list
  app test shards.
- Use native Turbo task dependencies and parallelism; do not compose Turbo
  invocations with shell `&&` in package scripts.
- Keep remote cache primary and the GitHub Actions `.turbo/cache` restore as
  secondary fallback.
- Keep `turbo.json` root-owned only for root tasks such as `//#openapi` and
  repository-wide dependency metadata.
- Every cacheable task declares only files it reads and outputs it writes;
  exclude runtime databases, coverage, test reports, and `.turbo/**` from
  explicit globs.
- Persistent servers and browser acceptance tasks are `cache: false`.
- Do not create a standalone type-only module or package.
- Each commit is independently reviewable and passes its targeted verification.

---

### Task 1: Make the existing Turbo graph cache-correct

**Files:**

- Modify: `turbo.json`
- Modify: `api/turbo.json`
- Modify: `scout/turbo.json`
- Modify: `libs/shared/turbo.json`
- Modify: `libs/discovery-engine/turbo.json`
- Modify: `app/turbo.json`
- Modify: `packages/atlas-api-client/turbo.json`
- Create: `packages/entity-widgets/turbo.json`
- Create: `packages/entity-widgets-mcp/turbo.json`
- Modify: `packages/eslint-config/turbo.json`
- Create: `packages/vitest-config/turbo.json`
- Create: `packages/tsconfig/turbo.json`
- Modify: `packages/eslint-config/package.json`
- Modify: `packages/vitest-config/package.json`
- Modify: `packages/tsconfig/package.json`
- Modify: `docs/development/turborepo.md`

**Interfaces:**

- Consumes: existing workspace scripts named `build`, `typecheck`, `lint`, and
  `test`.
- Produces: a graph where only packages with a real script define that task;
  `turbo run test --dry-run=json` contains no `<NONEXISTENT>` command.

- [ ] **Step 1: Add a graph-contract test**

Extend `scripts/validate-turbo-selectors.mjs` or add
`scripts/ci/turbo-graph-contract.test.mjs` with assertions over
`turbo run test --dry-run=json` and `turbo run build --dry-run=json`:

```js
assert.equal(
  tasks.some((task) => task.command === "<NONEXISTENT>"),
  false,
);
assert.equal(
  tasks.some(({ taskId }) => taskId === "@rebuildingamerica/atlas-app#test"),
  true,
);
```

- [ ] **Step 2: Run the contract before configuration changes**

Run: `node --test scripts/ci/turbo-graph-contract.test.mjs`

Expected: FAIL because root default task definitions create `<NONEXISTENT>`
tasks.

- [ ] **Step 3: Move standard task definitions to runnable packages**

Make root `turbo.json` contain only `globalDependencies`, genuinely
repository-wide environment policy, and root tasks beginning with `//#`. Define
`build`, `typecheck`, `lint`, and `test` only in the package configs that have
corresponding scripts. Retain `^build` only where a runnable dependency actually
produces consumed build output. Declare `outputs: []` for checks and test tasks;
declare concrete generated/build output paths for generation and builds.

Use this task shape for a package check:

```json
"test": {
  "dependsOn": ["^build"],
  "inputs": ["$TURBO_DEFAULT$", "vitest.config.ts"],
  "outputs": []
}
```

Remove no-op `build` and `test` scripts from the pure config packages. They are
configuration inputs, not build artifacts.

- [ ] **Step 4: Correct Python and root-task inputs**

In the Python package test definitions and root contract tasks, add exclusions
for transient input files:

```json
"!**/.turbo/**",
"!**/.coverage",
"!**/.coverage.*",
"!**/atlas.db",
"!**/htmlcov/**"
```

Keep `//#openapi` as the explicit producer of `openapi/atlas.openapi.json`. Keep
`@rebuildingamerica/atlas-api-client#api-client` dependent on that root task and
preserve its generated output declarations.

- [ ] **Step 5: Scope environment variables to their consumers**

Remove app- and API-specific names from root `globalEnv` and
`globalPassThroughEnv`. Declare cache-affecting configuration in the relevant
package task `env` arrays, and declare secrets needed only at execution time in
the narrowest task `passThroughEnv` array. Keep CI’s `TURBO_TOKEN` and
`TURBO_TEAM` workflow environment unchanged.

- [ ] **Step 6: Update operational documentation**

Update `docs/development/turborepo.md` to list every package config, explain
that a package owns a task only when it has a real script, and replace the stale
app-generated-client path with `packages/atlas-api-client/src/generated/**`.

- [ ] **Step 7: Verify the new graph and cache inputs**

Run:

```text
pnpm run turbo:validate
pnpm exec turbo run test --dry-run=json
pnpm exec turbo run build --dry-run=json
node --test scripts/ci/turbo-graph-contract.test.mjs
git diff --check
```

Expected: no `<NONEXISTENT>` tasks, no `.turbo/` input keys for Python test
tasks, and all selector validation passes.

- [ ] **Step 8: Commit**

Commit: `chore(dx): Scope Turbo tasks to runnable packages`

### Task 2: Extract the shared UI behavior package

**Files:**

- Create: `packages/atlas-ui/package.json`
- Create: `packages/atlas-ui/turbo.json`
- Create: `packages/atlas-ui/tsconfig.json`
- Create: `packages/atlas-ui/eslint.config.js`
- Create: `packages/atlas-ui/vitest.config.ts`
- Create: `packages/atlas-ui/src/ui/`
- Create: `packages/atlas-ui/src/layout/`
- Create: `packages/atlas-ui/src/styles/`
- Create: `packages/atlas-ui/src/hooks/`
- Modify: `app/package.json`
- Modify: `app/vite.config.ts`
- Modify: `app/vitest.config.ts`
- Modify: `app/tsconfig.json`
- Modify: imports under `app/src/components/`, `app/src/platform/`, and
  `app/src/routes/`
- Move: `app/src/platform/ui/` to `packages/atlas-ui/src/ui/`
- Move: `app/src/platform/layout/` to `packages/atlas-ui/src/layout/`

**Interfaces:**

- Consumes: `@rebuildingamerica/eslint-config`, `@rebuildingamerica/tsconfig`,
  and `@rebuildingamerica/vitest-config`.
- Produces: `@rebuildingamerica/atlas-ui` public exports for UI controls, layout
  primitives, styling utilities, and UI-specific hooks.

- [ ] **Step 1: Add a public-import test**

Create `packages/atlas-ui/src/index.test.ts` that imports one UI control and one
layout primitive from the package entrypoint:

```ts
import { Button, PageLayout } from ".";

void Button;
void PageLayout;
```

- [ ] **Step 2: Run the test before extraction**

Run: `pnpm --filter @rebuildingamerica/atlas-ui run test`

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Create the behavior-owning package**

Create a real package with `build`, `typecheck`, `lint`, and `test` scripts and
a package-local `turbo.json`. Export runtime components and their colocated
props/types from package entrypoints. Move only reusable presentation behavior;
route loaders, TanStack Start server functions, and domain policies remain in
their owning app/domain packages.

- [ ] **Step 4: Replace app-private imports**

Add `@rebuildingamerica/atlas-ui` as an app workspace dependency. Update Vite,
Vitest, and TypeScript resolution so tests consume the package public exports.
Replace imports from `src/platform/ui` and `src/platform/layout` without adding
compatibility re-export buckets.

- [ ] **Step 5: Verify package and app behavior**

Run:

```text
pnpm exec turbo run test --filter=@rebuildingamerica/atlas-ui
pnpm exec turbo run lint typecheck --filter=@rebuildingamerica/atlas-ui
pnpm exec turbo run test --filter=@rebuildingamerica/atlas-app
```

Expected: UI checks pass independently and routes still render through their
existing app tests.

- [ ] **Step 6: Commit**

Commit: `refactor(app): Extract shared UI behavior package`

### Task 3: Extract catalog and discovery behavior

**Files:**

- Create: `packages/atlas-catalog/package.json`
- Create: `packages/atlas-catalog/turbo.json`
- Create: `packages/atlas-catalog/src/`
- Modify: `app/package.json`
- Modify: `app/vite.config.ts`
- Modify: `app/vitest.config.ts`
- Move: `app/src/domains/discovery/` to `packages/atlas-catalog/src/discovery/`
- Move: `app/src/domains/firehose/` to `packages/atlas-catalog/src/firehose/`
- Move: `app/src/hooks/use-discovery.ts`, `app/src/hooks/use-entries.ts`, and
  `app/src/hooks/use-taxonomy.ts` to the matching catalog subdomain
- Move: reusable entry components under `app/src/components/entries/` to
  `packages/atlas-catalog/src/entries/`
- Modify: catalog-related route imports under `app/src/routes/_public/` and
  `app/src/routes/_workspace/`

**Interfaces:**

- Consumes: `@rebuildingamerica/atlas-api-client` for API contracts and
  `@rebuildingamerica/atlas-ui` for presentation primitives.
- Produces: `@rebuildingamerica/atlas-catalog` exports for search, places,
  sources, discovery, and firehose behavior.

- [ ] **Step 1: Add package-level behavior tests**

Move existing catalog, discovery, and firehose unit tests beside their behavior.
Add an entrypoint import test:

```ts
import { useEntries } from "@rebuildingamerica/atlas-catalog";

void useEntries;
```

- [ ] **Step 2: Run the entrypoint test before extraction**

Run: `pnpm --filter @rebuildingamerica/atlas-catalog run test`

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Move catalog behavior and colocate contracts**

Create the package with standard tasks and move the listed modules and their
tests. Export model interfaces from the files that implement the corresponding
search, map, place, source, or feed behavior. Import generated API contracts
from `@rebuildingamerica/atlas-api-client`; do not recreate API contracts or a
shared type bucket.

- [ ] **Step 4: Keep routes thin**

Update route modules to compose catalog package exports and route-specific
loader state only. Preserve existing URL paths, SSR behavior, and public-source
trust surfaces.

- [ ] **Step 5: Verify affected packages**

Run:

```text
pnpm exec turbo run test lint typecheck --filter=@rebuildingamerica/atlas-catalog
pnpm exec turbo run test --filter=@rebuildingamerica/atlas-app
rg '@/types|app/src/types|/types["'"'"']' app packages
```

Expected: package checks and app tests pass; the search returns no shared type
bucket.

- [ ] **Step 6: Commit**

Commit: `refactor(app): Extract catalog behavior package`

### Task 4: Extract access and workspace behavior

**Files:**

- Create: `packages/atlas-access/package.json`
- Create: `packages/atlas-access/turbo.json`
- Create: `packages/atlas-access/src/`
- Modify: `app/package.json`
- Modify: `app/vite.config.ts`
- Modify: `app/vitest.config.ts`
- Move: `app/src/domains/onboarding/` to `packages/atlas-access/src/onboarding/`
- Move: access/session/capability/identity behavior from `app/src/platform/`
  into `packages/atlas-access/src/`
- Move: reusable workspace identity behavior from `app/src/domains/workspace/`
  into `packages/atlas-access/src/workspace/`
- Modify: imports under `app/src/routes/_auth/`, `app/src/routes/_onboarding/`,
  and `app/src/routes/_workspace/`

**Interfaces:**

- Consumes: `@rebuildingamerica/atlas-api-client` and
  `@rebuildingamerica/atlas-ui`.
- Produces: `@rebuildingamerica/atlas-access` exports for session, capability,
  organization, sign-in, onboarding, and identity behavior.

- [ ] **Step 1: Add public behavior tests**

Move existing access, onboarding, and workspace tests beside their owning
behavior and add an entrypoint import test:

```ts
import { SignInEmailForm } from "@rebuildingamerica/atlas-access";

void SignInEmailForm;
```

- [ ] **Step 2: Run the test before extraction**

Run: `pnpm --filter @rebuildingamerica/atlas-access run test`

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Move behavior, not route adapters**

Move reusable access behavior into the package. Keep TanStack route files, HTTP
route handlers, browser redirects, and server-only secret reads in `app/`; pass
their route-derived values into package APIs. Export all access-facing models
from their owning module.

- [ ] **Step 4: Verify sign-in and workspace regression coverage**

Run:

```text
pnpm exec turbo run test lint typecheck --filter=@rebuildingamerica/atlas-access
pnpm exec turbo run test --filter=@rebuildingamerica/atlas-app
pnpm --filter @rebuildingamerica/atlas-app run test:acceptance:browser
```

Expected: package checks pass, app unit tests pass, and the non-Stripe browser
acceptance suite passes.

- [ ] **Step 5: Commit**

Commit: `refactor(app): Extract access behavior package`

### Task 5: Remove app-local test sharding and prove native concurrency

**Files:**

- Delete: `app/scripts/unit-test-shards.ts`
- Delete: `app/tests/unit/scripts/unit-test-shards.test.ts`
- Modify: `app/package.json`
- Modify: `app/turbo.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.githooks/pre-push`
- Modify: `scripts/deploy/prod-verify.sh`
- Modify: `docs/development/turborepo.md`

**Interfaces:**

- Consumes: standard package tasks created in Tasks 2–4.
- Produces: one native task name per concern across packages; CI and local
  quality use `turbo run test`, `turbo run lint`, and `turbo run typecheck`
  without application shard selectors.

- [ ] **Step 1: Add a dry-run graph assertion**

Extend the graph-contract test to require all behavior package test tasks:

```js
for (const taskId of [
  "@rebuildingamerica/atlas-ui#test",
  "@rebuildingamerica/atlas-catalog#test",
  "@rebuildingamerica/atlas-access#test",
]) {
  assert.equal(taskIds.has(taskId), true);
}
```

- [ ] **Step 2: Run it before removing shards**

Run: `node --test scripts/ci/turbo-graph-contract.test.mjs`

Expected: PASS after Tasks 2–4; this proves the new packages participate in
`turbo run test`.

- [ ] **Step 3: Delete custom shard orchestration**

Remove the shard scripts, app `test:unit:*` package scripts, and app
`test:unit:*` Turbo task definitions. Keep `app#test` only for app-owned route
and integration tests that cannot move to a behavior package. Leave root
`quality` as `turbo run typecheck lint test` and leave CI’s test job as
`pnpm exec turbo run test` with its existing affected flag.

- [ ] **Step 4: Confirm independent native tasks run concurrently**

Run: `pnpm exec turbo run test --output-logs=full`

Expected: Turbo schedules `atlas-ui`, `atlas-catalog`, `atlas-access`, API
client, Python packages, widgets, and remaining app tests as separate cacheable
tasks; no manual app shard task appears.

- [ ] **Step 5: Commit**

Commit: `chore(dx): Run app checks through package tasks`

### Task 6: Verify cache behavior and operational readiness

**Files:**

- Modify: `docs/development/turborepo.md`
- Modify: `scripts/bootstrap/phases/ci-cache.ts`
- Modify: `scripts/bootstrap/phases/ci-cache.test.ts`
- Modify: `scripts/validate-turbo-selectors.mjs`

**Interfaces:**

- Consumes: completed package task graph and GitHub Actions `TURBO_TOKEN` /
  `TURBO_TEAM` configuration.
- Produces: a documented, testable local and CI remote-cache setup with an
  explicit fallback cache.

- [ ] **Step 1: Add local cache-auth diagnostics**

Extend the bootstrap cache phase to call `turbo info` or an equivalent
non-mutating Turbo command and distinguish an authenticated remote cache from a
local-only cache. Keep token creation and GitHub secret updates opt-in within
the existing bootstrap workflow.

- [ ] **Step 2: Add a regression test for diagnostic language**

In `scripts/bootstrap/phases/ci-cache.test.ts`, assert that an unauthenticated
local result tells the operator to run `pnpm turbo login` and `pnpm turbo link`,
while CI configuration continues to describe `TURBO_TOKEN` and `TURBO_TEAM`.

- [ ] **Step 3: Verify quality and cache reuse**

Run:

```text
pnpm run turbo:validate
pnpm run actionlint
pnpm run quality
pnpm run test:ci
pnpm exec turbo run test --output-logs=full
```

Expected: the second `turbo run test` reports cache hits for unchanged package
tasks. If local credentials are present, the output also reports remote caching
enabled; otherwise it clearly reports the login/link command without making CI
claim failures.

- [ ] **Step 4: Commit**

Commit: `chore(dx): Verify Turbo cache boundaries`

## Commit Order

1. `chore(dx): Scope Turbo tasks to runnable packages`
2. `refactor(app): Extract shared UI behavior package`
3. `refactor(app): Extract catalog behavior package`
4. `refactor(app): Extract access behavior package`
5. `chore(dx): Run app checks through package tasks`
6. `chore(dx): Verify Turbo cache boundaries`

## Completion Criteria

- `turbo run test --dry-run=json` has no `<NONEXISTENT>` tasks.
- Changing only catalog code does not invalidate `atlas-access#test` or
  `atlas-ui#test`.
- CI invokes only `pnpm exec turbo run test` for cacheable test work.
- The root config contains no service-specific app, API, or Stripe environment
  settings.
- `rg '@/types|app/src/types|/types["'"'"']' app packages` returns no shared
  type bucket.
- The second unchanged Turbo test run reports cache hits; local remote-cache
  state is explicitly diagnosable.
