# Production ATProto Proof Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CI's production ATProto-first sign-in proof pass without exposing
the synthetic OAuth provider to ordinary users.

**Architecture:** Select the provider harness per sign-in-start request, record
that decision in expiring OAuth state, and accept a synthetic callback only for
state created by an authorized request. Playwright sends the existing
hosted-test secret only to the same-origin start route.

**Tech Stack:** TanStack Start server routes, TypeScript, Vitest, Playwright,
GitHub Actions, Vercel.

## Global Constraints

- Production and staging deployments remain owned by GitHub Actions.
- Do not run a local Vercel deployment or authentication flow.
- Browser use is limited to the Chrome profile for `willie@rebuildingus.org` and
  only when interactive authentication is unavoidable.
- Preserve unrelated work and keep the root checkout clean.
- Ordinary public requests must never enter the synthetic OAuth path.
- Production must not set `ATLAS_ATPROTO_OAUTH_E2E_HARNESS`.

---

### Task 1: Gate harness selection at the sign-in boundary

**Files:**

- Modify: `app/src/domains/access/server/hosted-e2e.ts`
- Modify: `app/src/routes/api/atproto/sign-in/start.ts`
- Test: `app/tests/unit/domains/access/server/hosted-e2e.test.ts`
- Test: `app/tests/unit/routes/api/atproto/sign-in/start.test.ts`

**Interfaces:**

- Produces:
  `isAtprotoSignInHarnessAuthorized(request: Request, env?: NodeJS.ProcessEnv): boolean`
- Consumes: `assertHostedE2EAuthorized()` and the existing local harness flag.

- [ ] **Step 1: Write failing behavioral tests**

Add cases proving a public request needs the hosted secret and production gate,
while a local test runtime may use the explicit local harness flag.

- [ ] **Step 2: Run focused tests and verify the new cases fail**

Run
`pnpm --filter @rebuildingamerica/atlas-app vitest run tests/unit/domains/access/server/hosted-e2e.test.ts tests/unit/routes/api/atproto/sign-in/start.test.ts`
and confirm failure because the request-scoped decision does not exist.

- [ ] **Step 3: Implement the minimal request gate**

Add the boolean helper and pass its result explicitly to
`createAtprotoSignInAuthorizationUrl` from the start route.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run the same Vitest command and require a clean pass.

### Task 2: Bind synthetic callbacks to authorized OAuth state

**Files:**

- Modify: `app/src/domains/access/server/atproto-oauth-stores.ts`
- Modify: `app/src/domains/access/server/atproto-oauth.ts`
- Test: `app/tests/unit/domains/access/server/atproto-oauth.test.ts`

**Interfaces:**

- Consumes: required `useE2EHarness: boolean` on sign-in authorization input.
- Produces: `e2eHarness: true` only on state created for an authorized synthetic
  sign-in.

- [ ] **Step 1: Write failing state and callback tests**

Add cases proving an explicit harness request stores the marker and succeeds
without the global flag, while the same callback against unmarked state cannot
create a session.

- [ ] **Step 2: Run the focused OAuth test and verify failure**

Run
`pnpm --filter @rebuildingamerica/atlas-app vitest run tests/unit/domains/access/server/atproto-oauth.test.ts`
and confirm the tests fail for the missing state binding.

- [ ] **Step 3: Implement the minimal state binding**

Require the per-request decision for sign-in URL creation, persist the marker,
and choose the synthetic callback only from matching stored state.

- [ ] **Step 4: Run the OAuth test and verify it passes**

Run the same focused test command and require a clean pass.

### Task 3: Send the hosted secret only to the sign-in start request

**Files:**

- Modify: `app/tests/e2e/atproto-identity-hosted.spec.ts`

**Interfaces:**

- Consumes: `ATLAS_HOSTED_E2E_SECRET` already supplied by staging and production
  workflows.
- Produces: a same-origin Playwright route override for
  `/api/atproto/sign-in/start`.

- [ ] **Step 1: Add the narrow request interception**

Register an exact same-origin route before the final username sign-in and add
`x-atlas-hosted-e2e-secret` only to that request.

- [ ] **Step 2: Run formatting, lint, typecheck, and focused tests**

Run the app formatter, linter, TypeScript compiler, and all focused tests from
Tasks 1 and 2.

### Task 4: Integrate through CI and prove the hosted result

**Files:**

- Verify: `.github/workflows/deploy-staging.yml`
- Verify: `.github/workflows/deploy-production.yml`

**Interfaces:**

- Consumes: existing GitHub environment secrets and release-tag workflow.
- Produces: green staging and production deployment workflows.

- [ ] **Step 1: Review the complete diff and run repository validation**

Confirm the production workflow does not set the global harness flag, run the
deploy-script tests and relevant app suites, then run the repository quality
gate.

- [ ] **Step 2: Commit and fast-forward local main**

Use the repository's atomic index-reset staging chain with only the intended
paths, then fast-forward the clean root checkout.

- [ ] **Step 3: Push main and require green staging CI**

Push the fast-forwarded main branch and wait for the staging workflow to finish.

- [ ] **Step 4: Tag and require green production CI**

Create the next release tag only after staging is green, push it, and wait for
the production deploy, smoke, and identity jobs to succeed.

- [ ] **Step 5: Verify live access**

Require successful public responses from the staging and production website, API
health, and PDS health endpoints, then verify root and origin state are clean
and aligned.
