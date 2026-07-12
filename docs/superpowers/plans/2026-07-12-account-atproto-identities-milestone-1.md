# Account-First ATProto Identities Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete external-ATProto identity experience: users manage
identities in Account settings, people and organizations use them for profile
verification, and verified profile links remain trustworthy across handle
changes and staff turnover.

**Architecture:** The catalog database stores one global row per DID plus
explicit user-control and profile-representation relations. The app server
remains the short-lived OAuth client; FastAPI owns durable identity state.
Account, claim, and profile-management surfaces share generated API contracts
and one TanStack Query identity cache.

**Tech Stack:** FastAPI, async raw SQL for SQLite/PostgreSQL, Pydantic/OpenAPI,
React 19, TanStack Start/Query/Router, Orval, Vitest, Playwright.

---

## Milestone Boundary

This milestone includes every external-provider capability in the approved
design. It excludes Atlas-managed PDS accounts, ATProto-first sign-in,
workspace-owned identities, delegated identity administration, and federated
publishing.

### Task 1: Migrate to the independent identity graph

**Files:**

- Modify: `api/atlas/models/schema_parts/04.sql`
- Modify: `api/atlas/models/sqlite_schema_parts/04.sql`
- Modify: `api/atlas/models/database_migrations.py`
- Modify: `api/atlas/models/database.py`
- Remove: `api/atlas/domains/catalog/models/atproto_schema.py`
- Test: `api/tests/platform/test_database_atproto_schema.py`
- Test: `api/tests/platform/test_database_schema_migrations.py`

- [x] **Step 1: Write failing fresh-schema and legacy-migration tests**

Cover fresh SQLite/PostgreSQL DDL, one legacy owner, duplicate cross-user DID
conflict, multiple entry links, an unresolved entry link, idempotent second
initialization, removal of legacy columns/indexes, and preservation of existing
identifiers.

```python
assert columns("atproto_identities") == {
    "id", "did", "current_handle", "pds_url", "resolution_status",
    "did_resolved_at", "handle_verified_at", "last_resolution_error",
    "created_at", "updated_at",
}
assert columns("user_atproto_controls") >= {
    "id", "identity_id", "user_id", "status", "verified_at",
    "disconnected_at", "created_at", "updated_at",
}
assert columns("profile_atproto_links") >= {
    "id", "entry_id", "identity_id", "claim_id", "proof_id", "status",
    "verified_at", "last_checked_at", "removed_at", "created_at", "updated_at",
}
```

- [x] **Step 2: Run the migration tests and confirm they fail on the user-owned
      schema**

Run:

```bash
cd api
uv run --extra dev pytest --no-cov \
  tests/platform/test_database_atproto_schema.py \
  tests/platform/test_database_schema_migrations.py -q
```

Expected: failures show `user_id` still lives on `atproto_identities`,
control/profile-link tables are missing, and entry-level ATProto columns remain.

- [x] **Step 3: Define the final schema in both dialect fragments**

Use the same state vocabulary in SQLite and PostgreSQL:

```sql
resolution_status CHECK(resolution_status IN ('verified', 'needs_attention'))
status CHECK(status IN ('active', 'disconnected', 'conflict'))
status CHECK(status IN ('verified', 'reverification_required', 'removed'))
```

Create `UNIQUE(did)`, `UNIQUE(user_id, identity_id)`, one partial unique
active-controller index per identity, and one partial unique non-removed profile
link per entry. Remove `entries.linked_atproto_*` from fresh schemas.

- [x] **Step 4: Implement one transactional, resumable migration for both
      databases**

Add `migrate_atproto_identity_graph(conn, backend=...)` and call it before
loading the fresh schema in `_init_sqlite` and `_init_postgres`. The migration
must:

```python
async def migrate_atproto_identity_graph(conn: Any, *, backend: str) -> None:
    """Replace legacy user-owned identities and entry columns atomically."""
```

Drop the legacy user index before renaming the table. Preserve one canonical
global row per DID by newest `updated_at`, create active controls for
single-user DIDs, create only conflict controls for multi-user DIDs, backfill
profile links from entry fields, and mark unresolvable legacy pairs
`reverification_required`. Drop the legacy table and entry columns only after
row-count assertions pass. On any mismatch, raise and roll back.

- [x] **Step 5: Remove the unused parallel schema helper and make initialization
      the only owner**

Delete `atproto_schema.py`, move its real initialization coverage into platform
migration tests, and remove imports/tests that exercise a non-runtime schema
path.

- [x] **Step 6: Run schema tests and commit**

```bash
cd api
uv run --extra dev pytest --no-cov \
  tests/platform/test_database_atproto_schema.py \
  tests/platform/test_database_schema_migrations.py -q
```

Expected: all migration cases pass twice in succession.

Commit: `chore(api): Migrate ATProto identity relationships`

### Task 2: Add global identity, control, and profile-link models

**Files:**

- Modify: `api/atlas/domains/catalog/models/atproto_identities.py`
- Create: `api/atlas/domains/catalog/models/atproto_identity_controls.py`
- Create: `api/atlas/domains/catalog/models/profile_atproto_links.py`
- Modify: `api/atlas/domains/catalog/services/atproto_identity.py`
- Test: `api/tests/domains/catalog/test_atproto_identity_service.py`

- [ ] **Step 1: Write failing CRUD and state-transition tests**

Test global DID upsert, same-user reconnect, second-user privacy-safe conflict,
active-control lookup, disconnect without identity deletion, profile-link
replacement, DID-first handle refresh, and resolution failure propagation.

```python
identity, control = await AtprotoIdentityControlCRUD.connect(
    db,
    user_id="user_1",
    did="did:plc:person",
    handle="person.example",
    pds_url="https://pds.example",
)
assert identity.did == "did:plc:person"
assert control.status == "active"
```

- [ ] **Step 2: Run the focused tests and confirm missing-model failures**

```bash
cd api
uv run --extra dev pytest --no-cov \
  tests/domains/catalog/test_atproto_identity_service.py -q
```

- [ ] **Step 3: Implement immutable dataclasses and focused CRUD classes**

`AtprotoIdentityCRUD` owns global DID metadata. `AtprotoIdentityControlCRUD`
owns user-control transitions and joined account listing.
`ProfileAtprotoLinkCRUD` owns verified, attention, replacement, and removal
transitions. Keep every write transactional at its service boundary and use `?`
placeholders.

- [ ] **Step 4: Add DID-first refresh semantics**

Replace the boolean-only refresh path with:

```python
@dataclass(frozen=True, slots=True)
class AtprotoIdentityResolution:
    did: str
    handle: str
    pds_url: str | None

async def resolve_current_atproto_identity(
    did: str,
    *,
    resolver: AtprotoIdentityResolver | None = None,
) -> AtprotoIdentityResolution | None:
    """Resolve the DID document, select its ATProto handle, and verify it forward."""
```

On success, update current handle/PDS and all active profile displays by
relation. On failure, set identity `needs_attention` and profile links
`reverification_required`; never clear or delete the relationship.

- [ ] **Step 5: Run model/service tests and commit**

```bash
cd api
uv run --extra dev pytest --no-cov tests/domains/catalog/test_atproto_identity_service.py -q
```

Commit: `chore(api): Model ATProto identity controls and profile links`

### Task 3: Expose the account identity lifecycle API

**Files:**

- Create: `api/atlas/domains/catalog/api/atproto_identities.py`
- Remove: `api/atlas/domains/catalog/api/profile_atproto.py`
- Modify: `api/atlas/domains/catalog/api/profiles.py`
- Modify: `api/atlas/platform/http/router.py`
- Modify: `api/atlas/domains/catalog/schemas/public_profiles.py`
- Modify: `api/atlas/domains/catalog/schemas/public.py`
- Test: `api/tests/domains/catalog/test_atproto_identity_api.py`

- [ ] **Step 1: Write failing API contract tests**

Cover internal OAuth completion, account list, successful refresh,
needs-attention refresh, disconnect, same-user reconnect, cross-user conflict,
wrong-user access, external API rejection, no-store headers, and linked-profile
summaries.

```python
response = await authenticated_client.get("/api/atproto/identities")
assert response.status_code == 200
assert response.json()[0]["control_status"] == "active"
assert "user_id" not in response.json()[0]
```

- [ ] **Step 2: Run the API tests and confirm route failures**

```bash
cd api
uv run --extra dev pytest --no-cov tests/domains/catalog/test_atproto_identity_api.py -q
```

- [ ] **Step 3: Implement the protected identity router**

Mount at `/api/atproto/identities` with operation IDs:

```text
GET    /api/atproto/identities                 listAtprotoIdentities
POST   /api/atproto/identities                 linkAtprotoIdentity
POST   /api/atproto/identities/{id}/refresh    refreshAtprotoIdentity
DELETE /api/atproto/identities/{id}            disconnectAtprotoIdentity
```

All operations accept only the app-server internal actor or local mode. The link
operation re-verifies the OAuth result, then atomically upserts the global
identity and active control. A competing active controller returns `409` with
`ATProto identity is already connected to another Atlas account.` and no user
metadata.

- [ ] **Step 4: Define one response model used by every account surface**

```python
class AtprotoIdentityProfileSummary(BaseModel):
    id: str
    name: str
    slug: str
    type: str

class AtprotoIdentityResponse(BaseModel):
    id: str
    did: str
    current_handle: str
    pds_url: str | None
    resolution_status: Literal["verified", "needs_attention"]
    control_status: Literal["active", "conflict"]
    connected_at: str
    verified_at: str
    last_checked_at: str
    last_resolution_error: str | None
    profiles: list[AtprotoIdentityProfileSummary]
```

- [ ] **Step 5: Run API tests and commit**

```bash
cd api
uv run --extra dev pytest --no-cov tests/domains/catalog/test_atproto_identity_api.py -q
```

Commit: `feat(api): Add ATProto identity lifecycle`

### Task 4: Move claims, review, revalidation, and public responses to relations

**Files:**

- Modify: `api/atlas/domains/catalog/api/profile_claim_atproto_helpers.py`
- Modify: `api/atlas/domains/catalog/api/profile_claim_structured.py`
- Modify: `api/atlas/domains/catalog/api/profile_claim_review.py`
- Modify: `api/atlas/domains/catalog/api/profile_claim_helpers.py`
- Modify: `api/atlas/domains/catalog/services/atproto_identity.py`
- Modify: `api/atlas/platform/mcp/data_record_helpers.py`
- Modify: `api/atlas/domains/catalog/schemas/public_common.py`
- Test: current ATProto claim, review, freshness, pairing, and public-response
  suites

- [ ] **Step 1: Rewrite fixtures to create global identities and active
      controls**

Replace every direct `AtprotoIdentityCRUD.upsert(user_id=...)` fixture with a
global identity plus `AtprotoIdentityControlCRUD.connect(...)`. Add explicit
tests that a disconnected or conflicting control cannot be submitted as claim
proof.

- [ ] **Step 2: Run the existing suites and confirm ownership assumptions fail**

```bash
cd api
uv run --extra dev pytest --no-cov \
  tests/domains/catalog/test_profile_claim_api.py \
  tests/domains/catalog/test_profile_claim_atproto_freshness.py \
  tests/domains/catalog/test_profile_claim_atproto_pairing.py \
  tests/domains/catalog/test_profile_claim_review_api.py \
  tests/domains/catalog/test_profile_claim_structured_preflight.py -q
```

- [ ] **Step 3: Authorize claims through active control records**

Both preflight and proof application must load the global identity and require
an active control for `actor.user_id`. On verification or reviewer approval,
write `profile_atproto_links`; never update removed entry columns.

- [ ] **Step 4: Derive public linked-handle fields from the verified relation**

Public response builders join the one non-removed profile link and expose its
handle only when both identity and link are verified. Needs-attention state is
returned without a confidently verified handle.

- [ ] **Step 5: Revalidate relations without deleting provenance**

The scheduled/admin revalidation path updates global identity metadata and
profile-link status. Update result counts from `cleared` to `needs_attention`,
and update the admin copy/tests accordingly.

- [ ] **Step 6: Run claim/public suites and commit**

```bash
cd api
uv run --extra dev pytest --no-cov \
  tests/domains/catalog/test_profile_claim_api.py \
  tests/domains/catalog/test_profile_claim_atproto_freshness.py \
  tests/domains/catalog/test_profile_claim_atproto_pairing.py \
  tests/domains/catalog/test_profile_claim_review_api.py \
  tests/domains/catalog/test_profile_claim_structured_preflight.py -q
```

Commit: `fix(api): Preserve profile identity across handle changes`

### Task 5: Add verified-steward profile attach and removal APIs

**Files:**

- Modify: `api/atlas/domains/catalog/api/profiles.py`
- Modify: `api/atlas/domains/catalog/schemas/public_profiles.py`
- Test: `api/tests/domains/catalog/test_profile_manage_api.py`

- [ ] **Step 1: Write failing steward-action tests**

Cover attach, replace, remove, non-steward rejection, disconnected-control
rejection, explicit replacement requirement, and removal without deleting the
account identity.

- [ ] **Step 2: Implement explicit endpoints**

```text
PUT    /api/profiles/{slug}/atproto-identity   attachProfileAtprotoIdentity
DELETE /api/profiles/{slug}/atproto-identity   detachProfileAtprotoIdentity
```

Attach accepts `{ "atproto_identity_id": "...", "replace": false }`. If another
active link exists, return `409` until the verified steward retries with
`replace: true`. Detach marks the profile link removed and leaves the global
identity/control untouched.

- [ ] **Step 3: Run manage tests and commit**

```bash
cd api
uv run --extra dev pytest --no-cov tests/domains/catalog/test_profile_manage_api.py -q
```

Commit: `feat(api): Let verified stewards manage public identities`

### Task 6: Regenerate and lock the API contract

**Files:**

- Modify: `openapi/atlas.openapi.json`
- Modify: `api/openapi/atlas.openapi.json`
- Modify: `mintlify/openapi/atlas.openapi.json`
- Generate: `app/src/lib/generated/atlas/**`
- Generate: `app/src/lib/generated/atlas-schemas/**`

- [ ] **Step 1: Regenerate from FastAPI and the checked-in OpenAPI artifact**

```bash
pnpm run openapi
cd app
pnpm run api-client
cd ..
pnpm run contract:test
```

Expected: generated operations use the exact operation IDs from Tasks 3 and 5,
schemas contain no account `user_id`, and contract tests pass.

- [ ] **Step 2: Commit checked-in contract artifacts**

Commit: `chore(api): Regenerate ATProto identity contracts`

### Task 7: Make OAuth return safely to Account, claims, and profile management

**Files:**

- Modify: `app/src/domains/access/server/atproto-oauth.ts`
- Modify: `app/src/routes/api/atproto/oauth/callback.ts`
- Modify: `app/src/routes/_workspace/account.tsx`
- Test: `app/tests/unit/domains/access/server/atproto-oauth.test.ts`
- Test: `app/tests/unit/routes/api/atproto/oauth/callback.test.ts`
- Test: `app/tests/unit/routes/_workspace/account.test.tsx`

- [ ] **Step 1: Write failing return-context tests**

Test allowlisted `/account`, `/claim/:slug`, and `/manage/:slug`; rejection of
every other path; Account hash preservation; opaque Account success parameters;
recoverable Account error with attempted handle; and unchanged claim
compatibility.

- [ ] **Step 2: Implement a typed return-context helper**

```ts
type AtprotoReturnContext =
  | { kind: "account" }
  | { kind: "claim"; slug: string }
  | { kind: "manage"; slug: string };

function parseAtprotoReturnTo(value: string): AtprotoReturnContext {
  // Accept only the three route shapes and throw for every other value.
}
```

Account success returns
`/account?atprotoStatus=connected&atprotoIdentityId=<opaque>#identity`. Claim
compatibility also includes handle until Task 9 moves selection to the shared
cache. Errors return `atprotoError` and `atprotoHandle` only to the originating
surface.

- [ ] **Step 3: Update OAuth persistence to the new identity endpoint**

Post callback results to `/api/atproto/identities`; preserve the existing
state/session cleanup and do not persist long-lived ATProto tokens.

- [ ] **Step 4: Run OAuth/route tests and commit**

```bash
cd app
pnpm vitest run \
  tests/unit/domains/access/server/atproto-oauth.test.ts \
  tests/unit/routes/api/atproto/oauth/start.test.ts \
  tests/unit/routes/api/atproto/oauth/callback.test.ts \
  tests/unit/routes/_workspace/account.test.tsx
```

Commit: `feat(app): Return ATProto connections to account settings`

### Task 8: Build the Account Identity experience

**Files:**

- Create: `app/src/domains/access/atproto-identities.ts`
- Create:
  `app/src/domains/access/pages/workspace/components/account/identity.tsx`
- Modify: `app/src/domains/access/pages/workspace/account-page.tsx`
- Modify: `app/tests/helpers/access/account-page-test-bed.tsx`
- Test: `app/tests/unit/domains/access/pages/account-page.test.tsx`
- Test: `app/tests/unit/domains/access/pages/account-page.visibility.test.tsx`

- [ ] **Step 1: Write failing account behavior tests**

Cover Identity tab order, empty state, provider-neutral handle form, connected
and needs-attention rows, profile summaries, technical disclosure, check,
reconnect, disconnect confirmation, success/error callback notices, query
invalidation, loading, and list failure.

- [ ] **Step 2: Add one shared query/mutation module**

```ts
export const atprotoIdentitiesQueryKey = [
  "auth",
  "atproto-identities",
] as const;
export function useAtprotoIdentities(): UseQueryResult<
  AtprotoIdentityResponse[]
>;
export function useRefreshAtprotoIdentity(): UseMutationResult<
  AtprotoIdentityResponse,
  Error,
  string
>;
export function useDisconnectAtprotoIdentity(): UseMutationResult<
  void,
  Error,
  string
>;
```

Import generated request and response types; do not create a second handwritten
DTO.

- [ ] **Step 3: Build the account section with existing primitives**

Insert Identity between Profile and Security for every signed-in non-local
account. Use `AccountSection`, `AccountSubsection`, `AccountSurface`,
`AccountRow`, `Button`, `Badge`, and the existing confirmation dialog. The
visible copy is:

```text
Identity
ATProto accounts
No ATProto accounts connected.
Connect ATProto account
ATProto handle
Check connection
Reconnect
Disconnect
Technical details
```

Disconnect confirmation names affected profiles and says their public identity
remains until a verified steward removes or replaces it.

- [ ] **Step 4: Run account tests and commit**

```bash
cd app
pnpm vitest run \
  tests/unit/domains/access/pages/account-page.test.tsx \
  tests/unit/domains/access/pages/account-page.visibility.test.tsx
```

Commit: `feat(app): Manage ATProto identities from Account`

### Task 9: Use Account identities in person and organization claims

**Files:**

- Create: `app/src/routes/_public/claim/-claim-atproto-identity-field.tsx`
- Modify: `app/src/routes/_public/claim/-claim-submission-panel.tsx`
- Modify: `app/src/routes/_public/claim/$slug.tsx`
- Create: `app/src/routes/_public/claim/claim-draft.ts`
- Test: `app/tests/unit/routes/_public/claim/**`

- [ ] **Step 1: Write failing person, organization, and draft tests**

Test person identity selection with pending review, organization domain-matching
selection, shared-service additional proof, disconnected-during-draft rejection,
connect-another return selection, same-tab draft restoration, submit cleanup,
and explicit cancellation cleanup.

- [ ] **Step 2: Replace the organization-only handle input with the shared
      selector**

Render for both entry types. People see **Verify this is you**. Organizations
keep **Show you represent this organization**. List active Account identities,
show needs-attention identities as unavailable, and retain **Connect another
account** as a secondary action that returns to the current claim.

- [ ] **Step 3: Preserve claim drafts through OAuth**

Store only the claim form state in `sessionStorage` under
`atlas:claim-draft:<slug>`. Restore on the same claim route and clear after
successful submission or explicit cancellation. Never store OAuth tokens or
provider responses.

- [ ] **Step 4: Run claim tests and commit**

```bash
cd app
pnpm vitest run tests/unit/routes/_public/claim
```

Commit: `feat(app): Verify people and organizations with linked identities`

### Task 10: Add verified-profile identity management and trustworthy public display

**Files:**

- Modify: `app/src/routes/_workspace/manage/$slug.tsx`
- Modify:
  `app/src/domains/catalog/components/profiles/linked-atproto-account.tsx`
- Modify: `app/src/domains/catalog/hooks/use-claims.ts`
- Test: `app/tests/unit/routes/_workspace/manage/**`
- Test:
  `app/tests/unit/domains/catalog/components/profile-redesign-data-quality.test.tsx`

- [ ] **Step 1: Write failing steward and public-display tests**

Cover attach, explicit replace confirmation, remove, disconnected identity
exclusion, non-steward API error, needs-attention public state, verified handle
text, and absence of a default `bsky.app` URL.

- [ ] **Step 2: Add Public identity to profile management**

Verified stewards select from active controlled identities, attach one,
explicitly replace an existing one, or remove it. Keep this separate from the
profile-details save request so identity changes have their own confirmation and
audit behavior.

- [ ] **Step 3: Render provider-neutral public identity**

Show the verified handle as text with verification date. Show a needs-attention
label without a confidently linked handle. Render an outbound anchor only when
the API later provides an explicitly verified public URL; milestone 1 provides
none.

- [ ] **Step 4: Run manage/public tests and commit**

```bash
cd app
pnpm vitest run \
  tests/unit/routes/_workspace/manage \
  tests/unit/domains/catalog/components/profile-redesign-data-quality.test.tsx
```

Commit: `feat(app): Manage verified profile identities`

### Task 11: Prove the end-to-end experience and align product plans

**Files:**

- Create: `app/tests/acceptance/domains/access/atproto-identities.spec.ts`
- Modify: `app/tests/acceptance/domains/public/atproto-claim.spec.ts`
- Modify: `docs/product/atproto-native-identity-transition.md`
- Modify: `docs/product/prds/07-atproto-federated-web-prd.md`
- Modify: `docs/product/prds/03-profile-claiming-and-stewardship-prd.md`
- Modify: `docs/plans/2026-06-25-atlas-feature-inventory.md`
- Modify: `docs/plans/2026-04-10-atlas-one-page-strategy-and-roadmap.md`

- [ ] **Step 1: Add browser acceptance for Account lifecycle**

Use the existing hermetic OAuth harness to connect a Bluesky-style handle and a
custom-PDS handle through the same Account action, check the connection,
disconnect with affected-profile copy, reconnect, and recover from a mismatched
callback. Assert the active workspace is unchanged.

- [ ] **Step 2: Expand profile acceptance**

Cover person pending review, organization custom-domain proof, shared-service
additional proof, draft restoration, approved public link, steward
replacement/removal, and needs-attention display. Stop intercepting the claim
submission where the real API behavior is required.

- [ ] **Step 3: Update the committed product plan**

Document Account as the identity home, external providers first, person and
organization consumption, workspace separation, and managed Atlas PDS as
deferred. Port the useful ATProto wording from
`chore/atproto-org-identity-plans` by reading it; do not edit, reset, or delete
that worktree.

- [ ] **Step 4: Run the complete verification matrix**

```bash
git diff --check

cd api
uv run --extra dev ruff format --check .
uv run --extra dev ruff check .
uv run --extra dev mypy atlas
uv run --extra dev pytest

cd ../app
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test:coverage
pnpm exec playwright test \
  tests/acceptance/domains/access/atproto-identities.spec.ts \
  tests/acceptance/domains/public/atproto-claim.spec.ts \
  tests/acceptance/domains/workspace/organization.spec.ts

cd ..
pnpm run contract:test
```

Expected: every command exits `0`, Python and app coverage remain at 100%, the
Account lifecycle works for both provider styles, people and organizations can
use linked identities, and workspace state is unchanged.

- [ ] **Step 5: Commit acceptance and documentation**

Commit: `docs: Align plans with account-first ATProto identity`
