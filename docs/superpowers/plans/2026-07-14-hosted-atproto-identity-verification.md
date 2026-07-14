# Hosted ATProto Identity Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repeatable staging-hosted signed-in ATProto identity verification
that does not depend on a developer's personal browser session.

**Architecture:** Add a fail-closed hosted E2E guard and narrow helper routes in
the app server, then drive the real staging UI with Playwright from GitHub
Actions using Vercel Trusted OIDC. Keep production non-mutating and keep the
existing fast hosted smoke separate.

**Tech Stack:** TanStack Start server routes, Better Auth internal adapter,
Playwright Chromium virtual WebAuthn, GitHub Actions, Vercel Trusted OIDC.

## Global Constraints

- Hosted helper routes return 404 unless `ATLAS_HOSTED_E2E_ENABLED=1`.
- Hosted helper routes require `ATLAS_HOSTED_E2E_SECRET` through an
  `x-atlas-hosted-e2e-secret` header.
- Hosted helper routes refuse to run when `ATLAS_DEPLOY_MODE=production` or
  `VERCEL_ENV=production`.
- Test data uses a run id prefix so cleanup targets only records created by the
  current hosted verification run.
- Production keeps only public/non-mutating smoke proof.
- Follow the repo staging rule:
  `git restore --staged . && command git add <paths...> && git commit -F <message-file>`.

---

## File Structure

- Create `app/src/domains/access/server/hosted-e2e.ts`: guard and helper
  operations for hosted verification.
- Create `app/src/routes/api/e2e/hosted/identity.ts`: POST route exposing the
  hosted helper surface.
- Modify `app/src/routeTree.gen.ts`: generated route tree after adding route.
- Create `app/tests/unit/domains/access/server/hosted-e2e.test.ts`: unit tests
  for fail-closed guard behavior and run-scoped payload validation.
- Create `app/tests/e2e/atproto-identity-hosted.spec.ts`: hosted staging UI
  verification.
- Create or modify `app/playwright.hosted-identity.config.ts`: hosted identity
  Playwright config.
- Modify `app/package.json`: add `test:hosted-identity`.
- Modify `.github/workflows/deploy-staging.yml`: add signed-in hosted identity
  job with OIDC and explicit secrets.
- Modify `scripts/ci/changed-surfaces.mjs` and
  `scripts/ci/changed-surfaces.test.mjs`: expose `hosted_identity` gating.
- Modify docs under `docs/superpowers/plans/account-atproto-identities/` after
  verification evidence exists.

---

### Task 1: Fail-closed hosted E2E guard

**Files:**

- Create: `app/src/domains/access/server/hosted-e2e.ts`
- Create: `app/tests/unit/domains/access/server/hosted-e2e.test.ts`

**Interfaces:**

- Produces:
  - `assertHostedE2EAuthorized(request: Request, env?: NodeJS.ProcessEnv): Response | null`
  - `hostedE2EPayloadSchema`
- Consumes: process env, request headers.

- [ ] **Step 1: Write failing guard tests**

Add tests proving disabled, missing-secret, wrong-secret, and production envs
all return 404, while staging with matching secret returns `null`.

Run:

```bash
cd app && pnpm vitest run tests/unit/domains/access/server/hosted-e2e.test.ts
```

Expected: fail because `hosted-e2e.ts` does not exist.

- [ ] **Step 2: Implement guard**

Create `hosted-e2e.ts` with the smallest implementation:

```ts
export function assertHostedE2EAuthorized(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Response | null {
  const enabled = env.ATLAS_HOSTED_E2E_ENABLED === "1";
  const deployMode = env.ATLAS_DEPLOY_MODE?.trim();
  const vercelEnv = env.VERCEL_ENV?.trim();
  const expectedSecret = env.ATLAS_HOSTED_E2E_SECRET?.trim();
  const actualSecret = request.headers.get("x-atlas-hosted-e2e-secret")?.trim();
  if (
    !enabled ||
    deployMode === "production" ||
    vercelEnv === "production" ||
    !expectedSecret ||
    actualSecret !== expectedSecret
  ) {
    return Response.json(
      { error: "Hosted E2E is unavailable." },
      { status: 404 },
    );
  }
  return null;
}
```

- [ ] **Step 3: Verify guard tests pass**

Run:

```bash
cd app && pnpm vitest run tests/unit/domains/access/server/hosted-e2e.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

Commit only the guard and tests.

---

### Task 2: Narrow hosted identity helper route

**Files:**

- Modify: `app/src/domains/access/server/hosted-e2e.ts`
- Create: `app/src/routes/api/e2e/hosted/identity.ts`
- Modify: `app/src/routeTree.gen.ts`
- Test: `app/tests/unit/domains/access/server/hosted-e2e.test.ts`

**Interfaces:**

- Consumes: `assertHostedE2EAuthorized()`, Better Auth internal adapter,
  organization membership helpers.
- Produces:
  - `seedHostedIdentityRun(request: Request): Promise<Response>`
  - JSON payload with owner and delegate email/user ids for one run.

- [ ] **Step 1: Write failing payload/route tests**

Extend unit tests for:

- invalid run id rejected,
- valid run id creates deterministic email prefixes,
- cleanup only accepts the same run prefix.

Run the hosted-e2e unit test and confirm failure before implementation.

- [ ] **Step 2: Implement helper operations**

Implement a single POST route with `action` values:

- `prepare`: creates or updates a verified owner and delegate user for the run,
  returning `{ ownerEmail, delegateEmail, runId }`.
- `cleanup`: removes only records whose emails contain the run prefix.

Keep the route server-only and guarded by `assertHostedE2EAuthorized()`.

- [ ] **Step 3: Regenerate route tree**

Run:

```bash
cd app && pnpm run generate:route-tree
```

- [ ] **Step 4: Verify unit tests pass**

Run:

```bash
cd app && pnpm vitest run tests/unit/domains/access/server/hosted-e2e.test.ts
```

- [ ] **Step 5: Commit**

Commit only route/helper/generated route tree changes.

---

### Task 3: Hosted identity Playwright suite

**Files:**

- Create: `app/playwright.hosted-identity.config.ts`
- Create: `app/tests/e2e/atproto-identity-hosted.spec.ts`
- Modify: `app/package.json`

**Interfaces:**

- Consumes:
  - `ATLAS_HOSTED_PUBLIC_URL`
  - `ATLAS_HOSTED_VERCEL_TRUSTED_OIDC_TOKEN`
  - `ATLAS_HOSTED_E2E_SECRET`
  - `ATLAS_HOSTED_E2E_RUN_ID`
- Produces:
  `pnpm --filter @rebuildingamerica/atlas-app run test:hosted-identity`.

- [ ] **Step 1: Write hosted test against missing helper behavior**

Write Playwright setup that calls `/api/e2e/hosted/identity` with OIDC and
secret headers, then fails if the helper is unavailable.

- [ ] **Step 2: Add virtual WebAuthn and UI journeys**

Drive Chromium through:

- account setup with passkey,
- organization page managed identity creation,
- delegated identity grant/remove/revoke,
- username sign-in path after passkey-backed account exists.

- [ ] **Step 3: Verify local syntax/typecheck**

Run:

```bash
cd app && pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

Commit the hosted identity test suite and package script.

---

### Task 4: Staging workflow integration

**Files:**

- Modify: `.github/workflows/deploy-staging.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/ci/changed-surfaces.mjs`
- Modify: `scripts/ci/changed-surfaces.test.mjs`

**Interfaces:**

- Consumes: CI changed-surface outputs and staging secrets.
- Produces: `hosted-identity` job gated by relevant changes or manual dispatch.

- [ ] **Step 1: Write changed-surface tests**

Add tests proving auth/ATProto/workspace app changes set `hosted_identity=true`,
docs-only changes do not, and `workflow_dispatch` can run it.

- [ ] **Step 2: Implement classifier output**

Add `hosted_identity` to CI outputs and set it for relevant auth, ATProto,
workspace, app hosted test, deploy staging workflow, or manual-dispatch changes.

- [ ] **Step 3: Add workflow job**

Add a `hosted-identity` job after deploy/API/PDS with:

- `id-token: write`,
- Vercel Trusted OIDC token,
- `ATLAS_HOSTED_E2E_ENABLED: "1"`,
- `ATLAS_HOSTED_E2E_SECRET: ${{ secrets.ATLAS_HOSTED_E2E_SECRET }}`,
- `ATLAS_HOSTED_E2E_RUN_ID: ${{ github.run_id }}-${{ github.run_attempt }}`,
- `ATLAS_HOSTED_PUBLIC_URL: ${{ secrets.ATLAS_PUBLIC_URL }}`.

- [ ] **Step 4: Verify classifier tests**

Run:

```bash
node scripts/ci/changed-surfaces.test.mjs
```

- [ ] **Step 5: Commit**

Commit workflow/classifier changes.

---

### Task 5: Documentation and evidence loop

**Files:**

- Modify: `docs/deployment/staging.md`
- Modify: `docs/superpowers/plans/account-atproto-identities/README.md`
- Modify:
  `docs/superpowers/plans/account-atproto-identities/milestone-12-managed-pds.md`
- Modify:
  `docs/superpowers/plans/account-atproto-identities/milestone-13-delegated-identity-and-sign-in.md`

**Interfaces:**

- Consumes: passing local checks and GitHub Actions run URLs.
- Produces: updated evidence for hosted signed-in staging proof.

- [ ] **Step 1: Document the harness**

Add staging docs describing the explicit env flags, production refusal, and CI
run behavior.

- [ ] **Step 2: Run focused checks**

Run:

```bash
cd app && pnpm vitest run tests/unit/domains/access/server/hosted-e2e.test.ts
cd app && pnpm tsc --noEmit
node scripts/ci/changed-surfaces.test.mjs
```

- [ ] **Step 3: Commit docs**

Commit documentation updates separately.

- [ ] **Step 4: Push and verify staging**

Push the branch, trigger or observe staging, and record the run URL once the
hosted identity job passes.
