# Atlas Capability System

The capability system is the internal engine that connects products to
feature access. It is the first milestone of the full billing stack and
ships independently of Stripe integration, pricing UI, or sign-up
changes.

## Why This Exists

Atlas needs to enforce feature boundaries so that purchasing a product
actually unlocks something. Today every signed-in user has unrestricted
access to every feature. This spec defines the plumbing that makes
product-gated access work: what capabilities exist, how products grant
them, how the app and API enforce them.

## Design Principles

1. **Product-driven, not tier-driven.** A workspace has zero or more
   active products. Each product independently grants capabilities. The
   resolver unions them. There is no tier hierarchy, no named "Free"
   tier — the absence of active products yields default capabilities.

2. **Code checks capabilities, never product names.** Feature gates
   reference capabilities like `workspace.export`, never product
   identifiers like `atlas_pro`. Adding a new product requires only
   updating the resolver config — zero feature gate code changes.

3. **Resolve at session load, enforce at use.** The app resolves
   capabilities once during session construction. The API resolves
   when it receives the active product list from the membership
   endpoint. Both carry resolved capabilities in their request context.

4. **Static config on both sides.** The product-to-capability mapping
   is a simple lookup table duplicated in TypeScript and Python. The
   mapping changes infrequently and is small enough (~30 lines) that
   duplication is preferable to cross-language generation or runtime
   service calls.

## Products

Atlas sells three products. Each is a Stripe product with one or more
prices. The capability system does not care about prices — it maps
product identifiers to capability grants.

| Product | Identifier | Billing Model |
|---|---|---|
| Atlas Pro | `atlas_pro` | Subscription ($5/mo, $48/yr) |
| Atlas Team | `atlas_team` | Subscription ($25/mo base + $8/seat/mo) |
| Atlas Research Pass | `atlas_research_pass` | One-time ($9/30d or $4/7d) |

There is no "Free" product. Free is the default state of every
workspace — the absence of any active product.

## Capabilities

Boolean feature flags. A workspace either has a capability or it does
not.

| Capability | What It Gates |
|---|---|
| `research.run` | Create research runs |
| `research.unlimited` | Bypass monthly research run limit |
| `workspace.notes` | Create and edit notes |
| `workspace.export` | Export data (CSV, JSON) |
| `workspace.shared` | Shared workspace (multiple members) |
| `api.keys` | Create API keys |
| `api.mcp` | MCP and OAuth access |
| `monitoring.watchlists` | Watchlists and monitoring digests |
| `integrations.slack` | Slack notifications and digests |
| `auth.sso` | SAML / OIDC single sign-on |

## Limits

Numeric constraints on usage. Unlimited is represented as `null` in
code (no ceiling).

| Limit | Default | Atlas Pro | Atlas Team | Research Pass |
|---|---|---|---|---|
| `research_runs_per_month` | 2 | unlimited | unlimited | unlimited |
| `max_shortlists` | 1 | unlimited | unlimited | unlimited |
| `max_shortlist_entries` | 25 | unlimited | unlimited | unlimited |
| `max_api_keys` | 0 | 1 | unlimited | 1 |
| `api_requests_per_day` | 0 | 1,000 | 10,000/key | 1,000 |
| `public_api_requests_per_hour` | 100 | unlimited | unlimited | unlimited |
| `max_members` | 1 | 1 | 50 | 1 |

## Product-to-Capability Mapping

| Capability | Default | Atlas Pro | Atlas Team | Research Pass |
|---|---|---|---|---|
| `research.run` | Yes | Yes | Yes | Yes |
| `research.unlimited` | No | Yes | Yes | Yes |
| `workspace.notes` | No | Yes | Yes | Yes |
| `workspace.export` | No | Yes | Yes | Yes |
| `workspace.shared` | No | No | Yes | No |
| `api.keys` | No | Yes | Yes | Yes |
| `api.mcp` | No | Yes | Yes | Yes |
| `monitoring.watchlists` | No | No | Yes | No |
| `integrations.slack` | No | No | Yes | No |
| `auth.sso` | No | No | Yes | No |

Atlas Research Pass resolves to the same capabilities and limits as
Atlas Pro.

## Resolution

Given a list of active products for a workspace, the resolver computes
effective capabilities and limits:

```
for each active product:
    product_caps   = PRODUCT_CAPABILITIES[product]
    product_limits = PRODUCT_LIMITS[product]

effective_caps   = union(DEFAULT_CAPABILITIES, all product_caps)
effective_limits = mostPermissive(DEFAULT_LIMITS, all product_limits)
```

`mostPermissive` takes the higher value for each limit, treating
`null` (unlimited) as greater than any number.

When a workspace has multiple active products (e.g., Atlas Team +
Research Pass), the union means capabilities from both apply. When
products overlap (Pro + Research Pass), the redundant grants are
harmless — the union is the same.

## Storage

### Organization Metadata

The existing `AtlasOrganizationMetadata` gains one field:

```typescript
interface AtlasOrganizationMetadata {
  ssoPrimaryProviderId: string | null;
  workspaceType: AtlasWorkspaceType;
  stripeCustomerId: string | null;       // NEW
}
```

`stripeCustomerId` links a workspace to its Stripe customer. This is
set when the workspace first enters a checkout flow (milestone 2).
It does not affect capability resolution — it is stored here for
convenience during Stripe integration.

No `tier` field. Products are the source of truth.

### `workspace_products` Table

A new table alongside Better Auth's tables in the app database. It
tracks which products are active for each workspace.

```sql
CREATE TABLE workspace_products (
    id                     TEXT PRIMARY KEY,
    workspace_id           TEXT NOT NULL,
    product                TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'active',
    granted_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at             TEXT,
    stripe_subscription_id TEXT,
    stripe_customer_id     TEXT,
    UNIQUE(workspace_id, product)
);

CREATE INDEX idx_workspace_products_workspace
    ON workspace_products(workspace_id);
```

Column details:

- `workspace_id` — references `organization.id` in Better Auth's
  table.
- `product` — one of `atlas_pro`, `atlas_team`,
  `atlas_research_pass`.
- `status` — `active`, `cancelled`, `past_due`, or `expired`.
- `granted_at` — when the product was activated.
- `expires_at` — `NULL` for subscriptions (ongoing until cancelled),
  set for passes (e.g., 30 days from purchase).
- `stripe_subscription_id`, `stripe_customer_id` — Stripe references,
  populated by webhooks in milestone 2. `NULL` until then.

The `UNIQUE(workspace_id, product)` constraint means one row per
product per workspace. Reactivation updates the existing row.

### Migration Approach

The app currently has no custom migration system — Better Auth manages
its own tables. The `workspace_products` table needs a lightweight
migration runner:

- A `runAtlasCustomMigrations()` function that runs after Better Auth
  migrations complete (inside `ensureAuthReady()`).
- Migrations are versioned SQL scripts in an array, executed in
  order.
- A `_atlas_migrations` tracking table records which migrations have
  run.
- Dual-mode: each migration provides both SQLite and PostgreSQL SQL
  when the syntax diverges (timestamps, types).

This keeps the approach minimal. If more custom tables are needed in
the future, the same runner handles them.

## App Integration (TypeScript)

### New File: `app/src/domains/access/capabilities.ts`

Contains:

- `AtlasProduct` — union type of product identifiers
- `AtlasCapability` — union type of capability names
- `AtlasLimit` — union type of limit names
- `PRODUCT_CAPABILITIES` — static map of product to capability set
- `PRODUCT_LIMITS` — static map of product to limit values
- `DEFAULT_CAPABILITIES` — capabilities with no active products
- `DEFAULT_LIMITS` — limits with no active products
- `ResolvedCapabilities` — the output type: `{ capabilities: Set<AtlasCapability>, limits: Record<AtlasLimit, number | null> }`
- `resolveCapabilities(activeProducts: AtlasProduct[]): ResolvedCapabilities` — the resolver
- `hasCapability(resolved: ResolvedCapabilities, cap: AtlasCapability): boolean`
- `getLimit(resolved: ResolvedCapabilities, limit: AtlasLimit): number | null`

### New File: `app/src/domains/access/server/workspace-products.ts`

Contains:

- `queryActiveProducts(workspaceId: string): Promise<AtlasProduct[]>` —
  queries `workspace_products` table for rows where `status = 'active'`
  and (`expires_at IS NULL` or `expires_at > now`).
- Uses the existing `getAuthDatabase()` / `getAuthPgPool()` dual-mode
  pattern from `sso-provider-store.ts`.

### Modified: `app/src/domains/access/session.types.ts`

`AtlasWorkspaceState` gains two fields:

```typescript
interface AtlasWorkspaceState {
  activeOrganization: AtlasWorkspaceMembership | null;
  activeProducts: AtlasProduct[];                    // NEW
  capabilities: AtlasWorkspaceCapabilities;
  resolvedCapabilities: ResolvedCapabilities;        // NEW
  memberships: AtlasWorkspaceMembership[];
  onboarding: { ... };
  pendingInvitations: AtlasWorkspaceInvitation[];
}
```

The existing `capabilities` field (role-based flags like
`canInviteMembers`) stays unchanged. `resolvedCapabilities` is the
product-driven capability set. Both coexist — role-based flags are
about *permission within a workspace*, product-based capabilities
are about *what the workspace can do*.

### Modified: `app/src/domains/access/server/organization-session.ts`

`loadAtlasWorkspaceState()` gains a step after resolving the active
organization:

1. Call `queryActiveProducts(activeOrganization.id)` to get the
   workspace's active products.
2. Call `resolveCapabilities(activeProducts)` to compute the
   resolved capability set.
3. Include both in the returned workspace state.

### Modified: `app/src/domains/access/organization-metadata.ts`

- Add `stripeCustomerId: string | null` to `AtlasOrganizationMetadata`
- Update `atlasOrganizationMetadataSchema` to include the new field
- Update `normalizeAtlasOrganizationMetadata()` to default it to `null`
- Update `mergeAtlasOrganizationMetadata()` to preserve it

## API Integration (Python)

### New File: `api/atlas/domains/access/capabilities.py`

Contains the same static config and resolver as the TypeScript side:

- `PRODUCT_CAPABILITIES: dict[str, set[str]]`
- `PRODUCT_LIMITS: dict[str, dict[str, int | None]]`
- `DEFAULT_CAPABILITIES`, `DEFAULT_LIMITS`
- `resolve_capabilities(active_products: list[str]) -> ResolvedCapabilities`
- `has_capability(resolved, cap: str) -> bool`
- `get_limit(resolved, limit: str) -> int | None`
- `require_capability(cap: str)` — returns a FastAPI dependency that
  raises HTTP 403 if the actor's resolved capabilities do not include
  the given capability. Error body: `{"detail": "Capability required", "capability": "<cap>"}`.
- `enforce_limit(limit: str)` — returns a FastAPI dependency that
  reads the actor's limit for the given name. The endpoint is
  responsible for checking current usage against the limit. Returns
  the limit value (or `None` for unlimited) for the endpoint to use.

### Modified: `api/atlas/domains/access/principals.py`

`AuthenticatedActor` gains two fields:

```python
@dataclass(slots=True)
class AuthenticatedActor:
    # ... existing fields ...
    active_products: list[str] | None = None         # NEW
    resolved_capabilities: ResolvedCapabilities | None = None  # NEW
```

### Modified: `api/atlas/domains/access/membership.py`

`MembershipResult` gains an `active_products` field:

```python
@dataclass(slots=True)
class MembershipResult:
    role: str
    slug: str
    name: str
    workspace_type: str
    active_products: list[str]  # NEW
```

`verify_org_membership()` parses `activeProducts` from the JSON
response and includes it in the result.

### Modified: `api/atlas/domains/access/dependencies.py`

`require_org_actor()` resolves capabilities after membership
verification:

```python
result = await verify_org_membership(actor.user_id, actor.org_id, settings)
# ... existing role/slug/workspace_type assignment ...
actor.active_products = result.active_products                    # NEW
actor.resolved_capabilities = resolve_capabilities(result.active_products)  # NEW
```

### Modified: `app/src/domains/access/server/internal-membership.ts`

`MembershipVerificationResponse` gains `activeProducts`:

```typescript
interface MembershipVerificationResponse {
  activeProducts: string[];      // NEW
  name: string;
  role: string;
  slug: string;
  workspaceType: "individual" | "team";
}
```

`verifyMembershipRequest()` queries `workspace_products` for the
organization and includes the result.

## Feature Gating

### App Side (TanStack Start)

UI components check capabilities to show/hide features:

```typescript
const { resolvedCapabilities } = session.workspace;

if (hasCapability(resolvedCapabilities, "workspace.export")) {
  // render export button
}
```

For limits, components read the numeric value:

```typescript
const maxShortlists = getLimit(resolvedCapabilities, "max_shortlists");
// null means unlimited, otherwise enforce the count
```

### API Side (FastAPI)

Endpoints use the new dependencies:

```python
@router.post("/orgs/{org_id}/research-runs")
async def create_research_run(
    actor: AuthenticatedActor = Depends(require_org_actor),
    _cap = Depends(require_capability("research.run")),
    limit: int | None = Depends(enforce_limit("research_runs_per_month")),
):
    if limit is not None:
        current_count = await count_research_runs_this_month(actor.org_id)
        if current_count >= limit:
            raise HTTPException(status_code=429, detail="Monthly research run limit reached")
    ...
```

### Existing Features to Gate

These are the features that exist today and need capability checks
wired in. The exact file locations will be identified during
implementation planning.

| Feature | Capability | Gate Location |
|---|---|---|
| Research runs | `research.run` + `research.unlimited` | API endpoint + app UI |
| Shortlists | (limit: `max_shortlists`) | API endpoint + app UI |
| Notes | `workspace.notes` | App UI (hide create/edit) |
| Export (CSV/JSON) | `workspace.export` | App UI (hide button) + API |
| API key creation | `api.keys` + limit `max_api_keys` | Account page + API |
| MCP / OAuth | `api.mcp` | Auth config |
| Organization invites | `workspace.shared` + limit `max_members` | Org page + API |
| SSO setup | `auth.sso` | Org page |

Watchlists, monitoring, and Slack integration do not exist yet, so
their gates are deferred until those features are built.

## What This Spec Does Not Cover

These are follow-up milestones, not part of this build:

- **Stripe integration** — webhook endpoint, checkout session
  creation, product lifecycle management
- **Billing UI** — pricing page, upgrade prompts, workspace settings
  billing section, Stripe Customer Portal link
- **Sign-up changes** — opening public registration, removing the
  allowlist gate
- **Usage tracking** — counting research runs, shortlists, API
  requests against limits (the enforcement points read counts, but
  the counting infrastructure depends on how each feature stores
  its data)
- **Grace periods** — what happens during `past_due` status
- **Upgrade prompts** — in-context messaging when a user hits a limit
