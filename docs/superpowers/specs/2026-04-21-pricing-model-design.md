# Atlas Pricing Model Design

## What Atlas Is

Atlas is a source-linked civic research platform that helps journalists,
creators, and nonprofits find and understand who is doing what in local
communities across America.

## Pricing Framework

### Value Layers

Atlas delivers value through four layers. Each layer builds on the one
below it:

```
Layer 4: Operations     Monitoring, integrations, SSO, team admin
Layer 3: Collaboration  Shared workspace, team notes, shared shortlists
Layer 2: Workspace      Personal shortlists, notes, exports, API, research runs
Layer 1: Graph          Browse, search, profiles, sources, public API reads
```

**Principle:** You never pay to *see* civic data. You pay to *work with
it* professionally.

This aligns with the roadmap guardrail: "Do not gate basic access for
independent creators and small organizations."

### Access Model

The pricing model maps value layers to payment:

| Layer | Access | Who Pays |
|---|---|---|
| **Graph** | Free, forever | Nobody. This is the civic mission. |
| **Workspace** | Subscription or pass | Individual researchers |
| **Collaboration** | Subscription (base) | Organizations |
| **Operations** | Subscription (per-seat) | Organizations, per member |

### Product Catalog

Everything Atlas sells is a **product** in Stripe. Each product has a
**billing model** (how you pay) and an **access model** (what it does to
your workspace).

| Product | Billing Model | Access Model | Target |
|---|---|---|---|
| Atlas Pro | Subscription ($5/mo, $48/yr) | Sets workspace tier to Pro | Individual researchers |
| Atlas Team | Subscription ($25/mo base + $8/seat/mo) | Sets workspace tier to Team | Newsrooms, nonprofits |
| Atlas Research Pass | One-time ($50/30 days) or weekly ($12/wk) | Grants Pro capabilities temporarily | Short-term projects |

There is no "Free" product. Free is the default state of every
workspace — it is the absence of an active subscription or pass.

**Subscriptions** set the workspace tier. A workspace has at most one
active subscription. Tier hierarchy: Free < Pro < Team.

**Passes** grant capabilities temporarily without changing the tier.
When a pass expires, the workspace reverts to whatever its subscription
tier is (or Free if none). A pass has no effect on a workspace that
already has equal or higher capabilities from its subscription.

## Product Details

### Atlas Pro

For the individual researcher who needs a professional workspace.

**Billing:** $5/month or $48/year (2 months free).

**What it unlocks (over Free):**

- Unlimited research runs (Free: 2/month)
- Unlimited shortlists and notes (Free: 1 shortlist, no notes)
- CSV and JSON export
- 1 API key (1,000 requests/day)
- MCP and OAuth access

### Atlas Team

For newsrooms, nonprofits, and research teams who need to coordinate.

**Billing:** $25/month base + $8/month per seat. Annual: $250/year
base + $80/year per seat. The base covers the workspace itself. Each
member beyond the first is one seat.

**What it unlocks (over Pro):**

- Shared workspace (collaborative shortlists and notes)
- Unlimited API keys (10,000 requests/day per key)
- Watchlists and monitoring digests
- Slack integration
- SSO (SAML / OIDC)
- Up to 50 members
- Priority support

### Atlas Research Pass

For short-term projects that need Pro capabilities without a
subscription commitment.

**Billing:** $50 one-time (30 days) or $12/week (auto-renewing).

**What it grants:** Pro-level capabilities for the pass duration.

**On expiry:** Workspace reverts to its subscription tier (typically
Free). Shortlists, notes, and saved research remain accessible
read-only until the user subscribes or buys another pass.

**Stacking:** No effect if the workspace already has Pro or Team.

## Plan Comparison

Every workspace is in exactly one tier based on its active subscription
(or Free by default). Passes can temporarily elevate a Free workspace
to Pro-level capabilities.

| | Free | Pro | Team |
|---|---|---|---|
| **Browse, search, profiles** | Unlimited | Unlimited | Unlimited |
| **Research runs** | 2/month | Unlimited | Unlimited |
| **Shortlists** | 1 (25 entries) | Unlimited | Unlimited (shared) |
| **Notes** | No | Unlimited | Unlimited (shared) |
| **Export (CSV, JSON)** | No | Yes | Yes |
| **API keys** | No | 1 (1k req/day) | Unlimited (10k req/day/key) |
| **MCP / OAuth** | No | Yes | Yes |
| **Watchlists & monitoring** | No | No | Yes |
| **Slack integration** | No | No | Yes |
| **SSO (SAML / OIDC)** | No | No | Yes |
| **Workspace type** | Individual | Individual | Team (shared) |
| **Members** | 1 | 1 | Up to 50 |
| **Priority support** | No | No | Yes |
| **Public API (unauthenticated)** | 100 req/hr | Unlimited | Unlimited |

## Capability System

The capability system is the internal engine that connects products to
feature access. It has three concepts:

1. **Capabilities** — boolean feature flags (can you do X?)
2. **Limits** — numeric constraints (how many X can you have?)
3. **Entitlements** — time-bounded grants from passes

Code always checks capabilities and limits, never product or tier
names. Adding a new product requires only updating the resolver — no
feature gate code changes.

### Resolution

```
tier_caps    = resolve_capabilities(workspace.tier)
tier_limits  = resolve_limits(workspace.tier)
pass_caps    = resolve_active_pass_capabilities(workspace)
pass_limits  = resolve_active_pass_limits(workspace)

effective_caps   = union(tier_caps, pass_caps)
effective_limits = most_permissive(tier_limits, pass_limits)
```

### Capabilities

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

### Limits

| Limit | Free | Pro | Team |
|---|---|---|---|
| `research_runs_per_month` | 2 | unlimited | unlimited |
| `max_shortlists` | 1 | unlimited | unlimited |
| `max_shortlist_entries` | 25 | unlimited | unlimited |
| `max_api_keys` | 0 | 1 | unlimited |
| `api_requests_per_day` | 0 | 1,000 | 10,000/key |
| `public_api_requests_per_hour` | 100 | unlimited | unlimited |
| `max_members` | 1 | 1 | 50 |

### Tier-to-Capability Mapping

| Capability | Free | Pro | Team |
|---|---|---|---|
| `research.run` | Yes | Yes | Yes |
| `research.unlimited` | No | Yes | Yes |
| `workspace.notes` | No | Yes | Yes |
| `workspace.export` | No | Yes | Yes |
| `workspace.shared` | No | No | Yes |
| `api.keys` | No | Yes | Yes |
| `api.mcp` | No | Yes | Yes |
| `monitoring.watchlists` | No | No | Yes |
| `integrations.slack` | No | No | Yes |
| `auth.sso` | No | No | Yes |

Atlas Research Pass resolves to Pro capabilities and limits.

## Stripe Product Mapping

| Stripe Product | Prices | Status |
|---|---|---|
| Atlas Research Pass | $50 one-time, $12/week | Exists (`prod_UMkuPoP6VUIIyT`) |
| Atlas Pro | $5/month, $48/year | Create new |
| Atlas Team Base | $25/month, $250/year | Create new |
| Atlas Team Seat (per unit) | $8/month, $80/year | Create new |
| Atlas Team (legacy) | — | Archive (`prod_UMku0d4n2sHTkm`) |

### Environment Variables

Populated by the bootstrap script after product sync:

```
STRIPE_PRODUCT_ATLAS_RESEARCH_PASS=prod_UMkuPoP6VUIIyT
STRIPE_PRICE_ATLAS_RESEARCH_PASS_ONCE=price_1TO1Oc00LmJOIDM0x5zRKXNT
STRIPE_PRICE_ATLAS_RESEARCH_PASS_WEEKLY=price_1TO1Oc00LmJOIDM0exBKYlvP
STRIPE_PRODUCT_ATLAS_PRO=prod_xxx
STRIPE_PRICE_ATLAS_PRO_MONTHLY=price_xxx
STRIPE_PRICE_ATLAS_PRO_YEARLY=price_xxx
STRIPE_PRODUCT_ATLAS_TEAM_BASE=prod_xxx
STRIPE_PRICE_ATLAS_TEAM_BASE_MONTHLY=price_xxx
STRIPE_PRICE_ATLAS_TEAM_BASE_YEARLY=price_xxx
STRIPE_PRODUCT_ATLAS_TEAM_SEAT=prod_xxx
STRIPE_PRICE_ATLAS_TEAM_SEAT_MONTHLY=price_xxx
STRIPE_PRICE_ATLAS_TEAM_SEAT_YEARLY=price_xxx
```

## Implementation Seams

### Where Tier State Lives

Workspace tier is stored in Better Auth's organization metadata:

```typescript
interface AtlasOrganizationMetadata {
  tier: "free" | "pro" | "team";
  ssoPrimaryProviderId: string | null;
  workspaceType: "individual" | "team";
}
```

Pass entitlements (Research Pass) are tracked separately — either via
a lightweight `entitlements` table or by querying Stripe's subscription
state for the customer.

### Billing State

Stripe is the source of truth for billing. Atlas does not maintain a
separate subscriptions table. Instead:

1. Stripe webhooks update `organization.metadata.tier`
2. The app reads `tier` from org metadata for capability resolution
3. The Stripe Customer Portal handles subscription changes,
   cancellations, and payment method updates

### Feature Gates

Code checks capabilities, not tier or product names:

```python
# API (FastAPI)
@router.post("/orgs/{org_id}/research-runs")
async def create_research_run(
    actor = Depends(require_org_actor),
    _cap = Depends(require_capability("research.run")),
    _quota = Depends(enforce_limit("research_runs_per_month")),
):
    ...
```

```typescript
// App (TanStack Start)
if (hasCapability(workspace, "workspace.export")) {
  // show export button
}
```

### Webhook Events

| Event | Action |
|---|---|
| `checkout.session.completed` | Set workspace tier or create pass entitlement |
| `customer.subscription.updated` | Update tier or pass entitlement |
| `customer.subscription.deleted` | Revert tier to `"free"` or expire pass |
| `invoice.payment_failed` | Flag workspace for grace period (optional) |

### Checkout Flow

1. User clicks upgrade in workspace settings
2. App creates a Stripe Checkout Session with the product's price(s)
3. User completes payment on Stripe-hosted checkout
4. Stripe fires `checkout.session.completed` webhook
5. Webhook handler updates workspace tier or creates pass entitlement
6. User returns to app, sees upgraded workspace

Customer portal link in workspace settings for managing active
subscriptions and passes.

## Extensibility

The framework supports future additions without structural changes:

- **New tier** (e.g., Enterprise): Add to tier union, define
  capabilities and limits in the resolver. No feature gate changes.
- **New pass product** (e.g., API Power Pack): Create Stripe product,
  define pass capabilities in the resolver. No feature gate changes.
- **New capability** (e.g., `analytics.dashboard`): Add to capability
  list, map to tiers in the resolver, add check in code.
- **New limit** (e.g., `max_exports_per_month`): Add to limits table,
  set values per tier, enforce at the relevant endpoint.

## What This Spec Does Not Cover

- Billing UI design (pricing page, upgrade prompts, plan management)
- Stripe Customer Portal customization
- Usage analytics dashboard for team admins
- Enterprise tier (custom pricing, dedicated support)
- Metered billing beyond rate limits
- Free trial periods

These are follow-up work items, not launch blockers.
