# Atlas-managed ATProto Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Add a real, monorepo-native Atlas PDS and complete organization
identity, delegated administration, and passkey-gated ATProto-first sign-in.

**Architecture:** Keep upstream `@atproto/pds` isolated as a Compose service.
Extend the existing global DID graph with small organization-link and delegation
relations; reuse the present OAuth BFF and Better Auth sessions instead of
introducing another identity database or session type.

**Tech Stack:** Docker Compose, Caddy, upstream `@atproto/pds`,
TypeScript/TanStack Start/Better Auth, Python/FastAPI, SQLite/PostgreSQL,
Vitest, pytest, Playwright.

## Global Constraints

- Never persist a PDS password or OAuth refresh token in the Atlas API database.
- External and Atlas-managed identities use the same global DID and
  account-control records.
- Organization actions require an active Better Auth owner/admin membership and
  an active delegation where the actor is not the identity controller.
- ATProto-first sign-in must reject unknown, disconnected, unverified, and
  passkey-less identities without account enumeration.
- Every task follows red-green-refactor, updates the matching milestone record,
  and commits using the repository staging workflow.

---

### Task 1: Add the upstream PDS service and deployment contract

**Files:**

- Create: `services/atproto-pds/pds.env.example`
- Create: `services/atproto-pds/README.md`
- Create: `services/atproto-pds/test-config.mjs`
- Modify: `compose.yaml`
- Modify: `deploy/Caddyfile`
- Modify: `.env.example`, `.env.production.example`, `turbo.json`
- Test: `services/atproto-pds/test-config.mjs`

**Interfaces:** Produces `ATLAS_PDS_PUBLIC_URL`, an `atlas-pds` compose service,
persistent `atlas-pds-data`, and a Caddy host route. Consumed by PDS
provisioning and browser tests.

- [ ] Write a node test that parses the service env example and rejects a PDS
      URL without `https://` or a hostname.
- [ ] Run `node --test services/atproto-pds/test-config.mjs`; expect failure
      because the files do not exist.
- [ ] Add the official PDS image, its dedicated volume, healthcheck, environment
      mapping, Caddy upstream, and documented recovery/backup commands.
- [ ] Re-run the node test and `pnpm run compose:validate`; expect both to pass.
- [ ] Commit `feat(pds): Add Atlas-managed PDS service`.

### Task 2: Model managed ownership, organization links, and delegations

**Files:**

- Modify: `api/atlas/models/database_migrations.py`
- Modify: `api/atlas/models/schema_parts/04.sql`
- Modify: `api/atlas/models/sqlite_schema_parts/04.sql`
- Create: `api/atlas/domains/catalog/models/organization_atproto_identities.py`
- Create: `api/atlas/domains/catalog/models/atproto_identity_delegations.py`
- Test: `api/tests/platform/test_database_atproto_managed_identity_schema.py`
- Test: `api/tests/domains/catalog/test_atproto_identity_delegations.py`

**Interfaces:**
`OrganizationAtprotoIdentityCRUD.attach(organization_id, identity_id, attached_by)`
and
`AtprotoIdentityDelegationCRUD.grant(organization_id, identity_id, controller_user_id, delegate_user_id, granted_by)`
return typed rows. Later API and app tasks consume these methods.

- [ ] Write SQLite and PostgreSQL tests asserting a single active org identity,
      unique active delegation, and cascade-safe revocation.
- [ ] Run the named pytest tests; expect missing model/import failures.
- [ ] Add migration DDL and focused CRUD modules with transaction-safe attach,
      grant, list, revoke, and active-authorization lookup methods.
- [ ] Re-run the named tests against SQLite and `ATLAS_TEST_POSTGRES_URL`;
      expect pass.
- [ ] Commit `feat(api): Model managed organization identities and delegations`.

### Task 3: Add organization identity and delegated-administration APIs

**Files:**

- Modify: `api/atlas/domains/catalog/api/atproto_identities.py`
- Create: `api/atlas/domains/catalog/api/organization_atproto_identities.py`
- Modify: `api/atlas/domains/catalog/schemas/public.py`
- Modify: `api/atlas/platform/http/router.py`
- Test: `api/tests/domains/catalog/test_organization_atproto_identity_api.py`

**Interfaces:** `POST /organizations/{organization_id}/atproto-identities`,
`POST /organizations/{organization_id}/atproto-identities/{identity_id}/delegations`,
and delegation deletion require Atlas internal identity plus verified
organization authorization.

- [ ] Write API tests for admin link success, member denial, controlled-identity
      enforcement, delegate grant, delegate action, and immediate revocation
      denial.
- [ ] Run the named pytest module; expect 404 or missing route failures.
- [ ] Implement schemas and route handlers that call the Task 2 CRUD methods and
      reuse the existing DID verifier without disclosing another controller.
- [ ] Re-run the module and OpenAPI export; expect pass and no checked-in
      contract drift.
- [ ] Commit `feat(api): Authorize organization ATProto identities`.

### Task 4: Add PDS provisioning adapter and managed identity lifecycle

**Files:**

- Create: `app/src/domains/access/server/atproto-pds.ts`
- Modify: `app/src/domains/access/server/atproto-oauth.ts`
- Modify: `app/src/domains/access/atproto-identities.ts`
- Test: `app/tests/unit/domains/access/server/atproto-pds.test.ts`
- Test: `app/tests/unit/domains/access/server/atproto-oauth.test.ts`

**Interfaces:** `provisionManagedAtprotoIdentity({ handle, userId })` returns
`{ did, current_handle, pds_url }`; it delegates protocol account creation to
the PDS adapter and persists only the returned public identity through the
established link API.

- [ ] Write a failing test for configured PDS validation, public-result
      persistence, and secret non-persistence.
- [ ] Run the two focused Vitest modules; expect a missing adapter error.
- [ ] Implement a narrow PDS HTTP client, runtime validation, and managed
      provisioning return context; reuse `persistLinkedAtprotoIdentity` for
      graph persistence.
- [ ] Re-run focused tests and
      `pnpm --filter @rebuildingamerica/atlas-app run typecheck`; expect pass.
- [ ] Commit `feat(app): Provision Atlas-managed ATProto identities`.

### Task 5: Add passkey-gated ATProto-first sign-in

**Files:**

- Modify: `app/src/domains/access/server/atproto-oauth.ts`
- Create: `app/src/domains/access/server/atproto-sign-in.ts`
- Create: `app/src/routes/api/atproto/sign-in/start.ts`
- Create: `app/src/routes/api/atproto/sign-in/callback.ts`
- Modify: `app/src/domains/access/pages/auth/sign-in-page.tsx`
- Test: `app/tests/unit/domains/access/server/atproto-sign-in.test.ts`
- Test: `app/tests/unit/routes/api/atproto/sign-in/callback.test.ts`

**Interfaces:** `completeAtprotoSignIn(params)` proves the DID maps to an active
control whose owner has `accountReady && hasPasskey`, then invokes the existing
Better Auth session mechanism.

- [ ] Write failing tests for successful linked/passkey-ready sign-in and
      identical rejection for unknown, disconnected, and passkey-less
      identities.
- [ ] Run the focused tests; expect missing module/route failures.
- [ ] Implement the OAuth return context, non-enumerating authorization guard,
      and existing-session handoff; render the alternate action only after
      passkey account creation has occurred.
- [ ] Re-run focused tests plus existing sign-in tests; expect pass.
- [ ] Commit `feat(app): Add passkey-gated ATProto sign-in`.

### Task 6: Add personal and organization identity UX

**Files:**

- Modify:
  `app/src/domains/access/pages/workspace/components/account/identity.tsx`
- Modify: `app/src/domains/access/pages/workspace/organization-page.tsx`
- Create:
  `app/src/domains/access/components/organization/atproto-identity-section.tsx`
- Modify: `app/src/domains/access/organizations.functions.ts`
- Test: `app/tests/unit/domains/access/pages/account-page.test.tsx`
- Test:
  `app/tests/unit/domains/access/components/organization/atproto-identity-section.test.tsx`
- Test: `app/tests/acceptance/domains/access/atproto-identities.spec.ts`

**Interfaces:** The organization section calls the Task 3 APIs through typed app
functions; it presents “Use Atlas identity” by default and “Connect existing
identity” as the equivalent external-provider path.

- [ ] Write failing UI tests for default managed selection, external connection,
      owner/admin controls, delegate invitation, and revoked-action feedback.
- [ ] Run the focused Vitest tests; expect missing component failures.
- [ ] Implement the shared identity selector and a small organization adapter
      component; do not fork the account connection flow.
- [ ] Re-run focused tests and the ATProto browser acceptance suite; expect
      pass.
- [ ] Commit `feat(app): Manage organization ATProto identities`.

### Task 7: Close out documentation and full verification

**Files:**

- Modify: `docs/product/atproto-native-identity-transition.md`
- Modify: `docs/superpowers/plans/account-atproto-identities/README.md`
- Create:
  `docs/superpowers/plans/account-atproto-identities/milestone-12-managed-pds.md`
- Create:
  `docs/superpowers/plans/account-atproto-identities/milestone-13-delegated-identity-and-sign-in.md`

- [ ] Record the new service topology, security boundaries,
      migration/backup/recovery operation, organization delegation lifecycle,
      and passkey gate.
- [ ] Run `pnpm run contract:test`, `pnpm run compose:validate`, PostgreSQL API
      tests, the ATProto browser suites, and the exact pre-push gate.
- [ ] Inspect the final diff and verify generated OpenAPI files are committed
      only when export output changes.
- [ ] Commit `docs(atproto): Document managed PDS identity operations`.
