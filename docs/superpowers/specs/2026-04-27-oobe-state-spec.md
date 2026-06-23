# Atlas OOBE — Pricing → Payment → Product State Specification

## Context

This document captures the full **out-of-box experience (OOBE)** for a new
Atlas user — every distinct state from "first arrival on the marketing
site" through "active paying user exercising paid capabilities." It is
the canonical reference for:

- engineering decisions about empty states, error states, and
  instrumentation
- product reviews of the activation funnel
- validating that the implemented flow matches intended behavior

The OOBE spans four systems:

1. **TanStack Start app** (`app/`) — public routes, auth UI, workspace
   UI, Stripe checkout server functions
2. **Better Auth** — sessions, organizations (workspaces),
   `workspace_products` table
3. **Stripe** — Checkout Sessions, Customer Portal, subscription
   lifecycle, webhooks
4. **FastAPI backend** (`api/`) — capability-gated endpoints, hydrates
   actor entitlements via Better Auth membership verification

## Top-level state diagram

```
                              ┌────────────┐
                              │   START    │
                              └─────┬──────┘
                                    ▼
                            ╔═══════════════╗
                            ║   ANONYMOUS   ║   any _public/* route
                            ╚═══════╤═══════╝
                                    │
              ┌─────────────────────┼──────────────────────┐
              ▼                     ▼                      ▼
        ┌──────────┐        ┌──────────────┐    ┌────────────────────┐
        │ Browsing │        │ViewingPricing│    │ RequestingDiscount │
        └────┬─────┘        └──────┬───────┘    └────────────────────┘
             │ "Create a free            │ click paid CTA (no session)
             │  account"                 ▼
             │                  ┌────────────────┐
             │                  │ SignInRedirect │ /sign-in?
             │                  └────────┬───────┘ redirect=/pricing
             │                           │ "Create account"
             └────────────► ◄────────────┘
                            ▼
                    ┌────────────────┐
                    │ SignUpStarted  │  /sign-up · submit email
                    └────────┬───────┘
                             ▼
                    ┌──────────────────┐
                    │ MagicLinkPending │  wait for email link
                    └────────┬─────────┘
                             ▼
                    ┌────────────────┐ ◄────────┐
                    │  AccountSetup  │          │ verify email
                    └────────┬───────┘ ─────────┘ register passkey
                             │ both done → accountReady=true
                             ▼
                  ┌──────────────────────────┐
                  │  WorkspaceProvisioning   │
                  │  (Stripe customer pre-   │
                  │   created here too)      │
                  └─────┬──────────────┬─────┘
       needsWorkspace   │              │   hasPendingInvitations
                        ▼              ▼
                ┌──────────────┐  ┌────────────────────┐
                │ FreeWorkspace│  │ PendingInvitations │
                │  /discovery  │  │   /organization    │
                └──────┬───────┘  └─────────┬──────────┘
                       │                    │ accept invite
                       │                    ▼
                       │             ┌─────────────────┐
                       │             │ JoinedWorkspace │
                       │             └────────┬────────┘
                       └──────────┬───────────┘
                                  ▼
                         ╔═══════════════════╗
                         ║   AuthedPricing   ║   /pricing (signed in)
                         ╚═════════╤═════════╝
                                   │ click paid CTA
                                   ▼
                         ┌────────────────────┐
                         │ CheckoutInitiated  │  startCheckout()
                         │  - resolve priceId │  resolves coupon,
                         │  - ensure customer │  metadata.workspace_id
                         └─────────┬──────────┘
                                   ▼
                         ┌────────────────────┐
                         │  AtStripeCheckout  │  (off-domain)
                         └────┬──────────┬────┘
                       cancel │          │ payment success
                              ▼          ▼
                 ┌─────────────────┐  ┌──────────────────────┐
                 │CheckoutCancelled│  │  CheckoutCompleted   │
                 │  → /pricing     │  │  /account?           │
                 └────────┬────────┘  │   checkout=success   │
                          │           └──────────┬───────────┘
                          ▼                      ▼
                   AuthedPricing       ┌────────────────────┐
                                       │   Provisioning     │ /checkout-
                                       │  (poll session     │  complete
                                       │   until product    │  · 30s
                                       │   appears)         │  timeout
                                       └─────────┬──────────┘
                                                 │ webhook upserts
                                                 │ workspace_products
                                   ┌─────────────┴─────────────┐
                                   ▼                           ▼
                       ┌────────────────────┐       ┌──────────────────┐
                       │  ActiveSubscriber  │       │   ActivePass     │
                       │   (Pro / Team)     │       │    7d / 30d      │
                       └─┬────────┬───────┬─┘       └────────┬─────────┘
                         │        │       │                  │ expires_at
                         │        │       └─────► Manage     ▼
                         │        │              Billing (Stripe
                         │        │              Customer Portal)     ┌──────────────┐
                         │        │                                   │ ExpiredPass  │
                         │        │ subscription.deleted              └──────┬───────┘
                         │        ▼                                          │
                         │   ┌──────────┐                                    │
                         │   │Cancelled │                                    │
                         │   └────┬─────┘                                    │
                         │        │                                          │
              past_due   │        │   capabilities re-resolve                │
                         ▼        ▼                                          ▼
                     ┌────────┐  ╔════════════════════════════════════════════╗
                     │PastDue │  ║              FreeWorkspace                 ║
                     └───┬────┘  ║  (resolveCapabilities returns free tier)   ║
                         │       ╚════════════════════════════════════════════╝
                payment  │
                recovers └──► ActiveSubscriber
```

**Reading the diagram:**

- `╔═══╗` boxes mark **steady-state** surfaces a user spends time on
  (`Anonymous`, `AuthedPricing`, `FreeWorkspace`).
- `┌───┐` boxes are **transitional** states (forms, redirects, off-domain
  pages, webhook races).
- A single arrow is a deterministic transition; forks (e.g.
  `WorkspaceProvisioning`) branch on session metadata.
- Re-entries from `Cancelled` / `ExpiredPass` collapse back into
  `FreeWorkspace` because capability resolution is recomputed on every
  session load.

## Phase 1 — Anonymous

### State: `Anonymous` (entry)

- **Surface:** any `_public/*` route, e.g. `/`, `/browse`, `/profiles/*`,
  `/pricing`, `/request-discount`
- **Session:** no Better Auth session
- **Capabilities:** none. Free-tier *limits* (`research.run`, public API
  100 req/hr) are advertised on the pricing page but only granted after a
  workspace exists.
- **Code:** `app/src/routes/_public.tsx`,
  `app/src/platform/pages/home-page.tsx`

### State: `ViewingPricing`

- **Surface:** `/pricing` rendered by
  `app/src/domains/billing/pages/public/pricing-page.tsx`
- **Sub-state:** `billing` ∈ {`monthly`, `annual`} controls displayed
  prices via `PlanCard`
- **CTAs:**
  - **Free** → routes to `/browse` (no auth)
  - **Atlas Pro / Atlas Team / Research Pass** →
    `handleCheckout({ product, interval })` (line 167)
- **Transition logic** (line 168–171): if `!session.data` → redirect to
  `/sign-in?redirect=/pricing`. Otherwise dynamic-import
  `checkout.functions.ts` and call `startCheckout`.
- **Note:** clicking a paid CTA while anonymous **does not preserve the
  chosen product/interval** through sign-up. After auth, the user lands on
  `/discovery` (per `account-setup-page.tsx` line 84), not back at
  `/pricing` with the original CTA primed. Documented gap; see Edge cases.

### State: `RequestingDiscount`

- **Surface:** `/request-discount` (verify-then-discount form for
  nonprofits/journalists/researchers)
- **Outcome:** sets organization metadata
  `verificationStatus='verified'` + `discountSegment`. Coupons are
  auto-attached at checkout via `getDiscountCouponId()` in
  `checkout.functions.ts:74`.

## Phase 2 — Sign-up and account setup

Auth provider is **Better Auth** with email magic links + passkeys. Public
sign-up is **open** (no waitlist gate found).

### State: `SignUpStarted`

- **Surface:** `/sign-up` (`app/src/routes/_auth/sign-up.tsx`). Form
  collects email; if account already exists, routes to `/sign-in`.

### State: `MagicLinkPending`

- **Surface:** post-submit confirmation screen ("we sent you a link").
  User leaves the app and clicks the link in their email client.

### State: `AccountSetup`

- **Surface:** `/account-setup` rendered by
  `app/src/domains/access/pages/auth/account-setup-page.tsx`
- **Required completions:**
  1. Email verified
  2. Passkey registered
- **Auto-refresh hooks** (lines 90–111): re-poll session on mount and on
  tab visibility changes (so verifying in another tab progresses this
  tab).
- **`accountReady` gate** (line 57): when both checks pass, the page
  proceeds.

### State: `WorkspaceProvisioning`

- **Code:** `account-setup-page.tsx:61–80` and `createWorkspace()` in
  `app/src/domains/access/organizations.functions.ts:69–102`
- **Behavior:** if `needsWorkspace && !hasPendingInvitations`, auto-create
  a Better Auth organization named `"{user.name}'s Workspace"` with
  `workspaceType='individual'`. The Stripe customer is **pre-created
  here** so checkout doesn't have to create one inline (see
  `ensureStripeCustomerForWorkspace`, used both at workspace creation and
  as a fallback in `startCheckout`).
- **Forks:**
  - has invitations → land on `/organization`
  - default → land on `/discovery`
- **Exits to:** `FreeWorkspace` or `JoinedWorkspace`

### State: `PendingInvitations`

- User has unaccepted invitations. They are routed to `/organization` to
  choose. After accept, capabilities reflect the inviting workspace's
  `workspace_products`.
- A teammate who follows an emailed invite link instead lands on
  `/accept-invitation/{invitationId}`, which auto-accepts after auth (see
  the Team workspace flow below). Accepting reconciles the inviting
  workspace's Stripe seat count (`syncTeamSeats`).

## Phase 3 — Authenticated free use

### State: `FreeWorkspace` (default landing)

- **Surface:** `/discovery` and `_workspace/*` routes (gated by
  `requireReadyAtlasSession`, `app/src/routes/_workspace.tsx:29–32`)
- **Active products:** none (`activeProducts: []`)
- **Resolved capabilities:** `research.run` only (free tier in
  `capabilities.ts:44–50`); free *limits* apply (2 research runs/month, 1
  shortlist, 100 req/hr public API)
- **Visible upgrade prompts:**
  - Workspace billing section (`workspace-billing-section.tsx:25–104`):
    "Upgrade to Pro or Team" → `/pricing`
  - Public nav has "Pricing" link visible while signed in
- **Documented gap (frontend):** at-limit gating in
  `discovery-page.tsx:241` *disables* the Run button when
  `canRunResearch` is false but does not surface an upgrade modal/banner.

### State: `AuthedPricing`

- Same `/pricing` page, but `session.data` is present so `handleCheckout`
  no longer redirects; it calls `startCheckout` immediately.

## Phase 4 — Checkout (Stripe-hosted)

### State: `CheckoutInitiated`

- **Code:** `startCheckout` server function in
  `app/src/domains/billing/checkout.functions.ts:46–112`
- **Steps:**
  1. Resolve `priceId` from `(product, interval)` via `resolvePriceId`
     (lines 21–38). Throws if env var missing.
  2. Require active workspace from session. Throws if none.
  3. Read normalized org metadata (verification status, discount segment,
     stripe customer id).
  4. If `verified` + `discountSegment` set → attach Stripe coupon via
     `getDiscountCouponId`.
  5. If no `stripeCustomerId` on metadata → call
     `ensureStripeCustomerForWorkspace` (best-effort; failure falls
     through to `customer_email`).
  6. Build `successUrl = ${publicBaseUrl}/account?checkout=success` and
     `cancelUrl = ${publicBaseUrl}/pricing`.
  7. Call `createCheckoutSession`
     (`app/src/domains/billing/server/checkout.ts:29–78`):
     - mode = `payment` for `atlas_research_pass`, `subscription`
       otherwise
     - metadata = `{ workspace_id, product }` on session and (for
       subscriptions) on `subscription_data` so
       `customer.subscription.created` can resolve workspace without the
       session
  8. Return `{ url }` and the client `window.location.assign`s it.

### State: `AtStripeCheckout`

Off-domain. Stripe handles payment method, taxes, address, etc.

### State: `CheckoutCancelled`

User clicked "Back" on Stripe → redirected to `cancelUrl` = `/pricing`.
Returns to `AuthedPricing`. No webhook fires; no DB change.

### State: `CheckoutCompleted`

- Stripe redirects to `successUrl` =
  `/checkout-complete?product={product}`.
- The webhook (`checkout.session.completed`) is delivered to
  `/api/stripe/webhook` independently. The user lands on
  `/checkout-complete` while the webhook may still be in flight.
- **Webhook handler:**
  `app/src/domains/billing/server/webhook-handler.ts`
- **Events handled:** `checkout.session.completed`,
  `customer.subscription.created/updated/deleted`. All other events are
  silently ignored.
- **Idempotency:** every event carries `event.created`, which is stored
  on the row as `stripe_event_at`. Upserts and updates compare against
  the stored value and skip writes when the inbound event is older,
  preventing out-of-order delivery from regressing live state.

### State: `Provisioning` → `Provisioning`

- The user lands on `/checkout-complete?product={product}`
  (`app/src/domains/billing/pages/workspace/checkout-complete-page.tsx`).
  The page polls `useAtlasSession` (invalidating the session query every
  1.5s) until `activeProducts` contains the purchased product, then
  redirects to `/account`.
- **Timeout:** after 30s, the page shows a "we'll catch up shortly"
  message with a Refresh button and a link to `/account`. This bounds
  the race so a stuck webhook never strands the user on a spinner.

## Phase 5 — Active product use

### State: `ActiveSubscriber` (Pro / Team)

- **Triggered by:** `checkout.session.completed` →
  `handleCheckoutCompleted` upserts `workspace_products` row with
  `status='active'` and persists `stripeCustomerId` onto org metadata
  (`webhook-handler.ts:115–163`).
- **Subsequent updates:** `customer.subscription.updated` runs
  `mapSubscriptionStatus` and updates the row by `stripe_subscription_id`
  (lines 204–207).
- **Capabilities:** resolved via `queryActiveProducts(workspaceId)` →
  `resolveCapabilities(activeProducts)` on each session load. TypeScript
  and Python implementations mirror each other
  (`app/src/domains/access/capabilities.ts` and
  `api/atlas/domains/access/capabilities.py`).
- **API enforcement:** FastAPI `require_capability` dependencies; the
  actor's `activeProducts` is hydrated by Better Auth membership
  verification (internal endpoint at
  `/api/auth/internal/memberships/{org_id}/members/{user_id}`).

### State: `ActivePass`

- **Triggered by:** payment-mode `checkout.session.completed`. Same
  upsert path; product = `atlas_research_pass`.
- **Distinguishing field:** `expires_at` (set per pass duration: 7d or
  30d). The current resolver does **not** appear to filter by `expires_at`
  automatically — there is no scheduler that flips `status` to `expired`.
  **Documented gap / open question:** confirm whether
  `queryActiveProducts` filters `expires_at > now()` at read time, or
  whether a job is required.

### State: `PastDue`

`customer.subscription.updated` with status `past_due` → row status
flips to `past_due`. Capability resolution treats only `status='active'`
as entitled (verify in `queryActiveProducts`).

### State: `Cancelled`

`customer.subscription.deleted` → status `cancelled`. User reverts to
free-tier capabilities. Workspace and account remain.

### State: `ManagingBilling`

- **Surface:** workspace billing section "Manage Subscription" →
  `createPortalSession()` → Stripe Customer Portal
- **Returns:** to the configured Customer Portal return URL inside the
  workspace.

## Phase 6 — Team workspace (multi-member)

Atlas Team layers shared, multi-member workspaces on top of the
subscription machinery in Phases 4–5. The seat *economics* (base + one
seat per member after the first, 50-member cap) are defined once in the
[pricing model spec](2026-04-21-pricing-model-design.md#atlas-team); this
section only traces the OOBE states.

There are two ways into a team workspace: provision one directly at
workspace creation, or upgrade an existing individual workspace in place.
Both converge on `TeamUnsubscribed` (a free team that cannot yet invite),
then subscribe to unlock invitations.

```
            ┌─────────────────────┐        ┌──────────────────────────┐
            │  FreeWorkspace      │        │ workspace-creation form  │
            │ (individual, Ph. 3) │        │  workspaceType='team'    │
            └──────────┬──────────┘        └────────────┬─────────────┘
                       │ "Upgrade to a team"            │ create
       flip metadata   │ workspaceType                  │
       individual→team │ (updateOrganization)           │
                       ▼                                ▼
                     ╔══════════════════════════════════════╗
                     ║          TeamUnsubscribed            ║  free team
                     ║  workspaceType='team', no atlas_team ║  workspace;
                     ║  invites BLOCKED (gate throws)       ║  /organization
                     ╚════════════════════╤═════════════════╝
                                          │ subscribe to Atlas Team
                                          │ (Phase 4 checkout; base price,
                                          │  + seat item if members−1 ≥ 1)
                                          ▼
                     ╔══════════════════════════════════════╗
                     ║           TeamSubscribed             ║  atlas_team
                     ║  invites ENABLED, capped at          ║  active
                     ║  max_members (members + pending)     ║
                     ╚════════════════════╤═════════════════╝
                                          │ invite teammate (email)
                                          ▼
                     ┌──────────────────────────────────────┐
                     │           InvitePending              │  seat NOT
                     │  pending invitation counts toward cap│  yet billed
                     └────────────────────┬─────────────────┘
                            invitee opens │ /accept-invitation/{id}
                            emailed link  │ (auto-accept after auth)
                                          ▼
                     ┌──────────────────────────────────────┐
                     │            SeatReconciled            │  syncTeamSeats
                     │  member joins → seat qty = members−1 │  (proration)
                     └──────────────────────────────────────┘
```

### State: `TeamUnsubscribed`

- **Reached by:**
  - **Direct creation** — `createWorkspace()` with
    `workspaceType='team'` (workspace-creation section). An optional
    delegated-admin email sends a handoff invite, but the invite itself
    still needs an active subscription before it can be (re)sent from the
    members panel.
  - **Upgrade in place** — an existing individual `FreeWorkspace` flips
    its metadata `workspaceType` to `team` via `updateOrganization`. No
    new tenant is created: the workspace *is* the Better Auth
    organization / API `org_id`; `workspaceType` is a mode flag, so the
    same workspace, members, and Stripe customer carry over.
- **Surface:** `/organization`
- **Active products:** none. Capabilities are still free-tier.
- **Invite gate:** `inviteWorkspaceMember` throws
  ("Subscribe to Atlas Team to invite members…") because
  `activeProducts` does not include `atlas_team`. A free team workspace
  can exist but cannot add members.
- **Exit:** subscribe to Atlas Team via the Phase 4 checkout flow.

### State: `TeamSubscribed`

- **Reached by:** completing Atlas Team checkout. The Checkout Session
  carries the base price line item, plus a per-seat line item whenever
  the initial seat quantity (members − 1) is ≥ 1 — built in
  `server/checkout.ts`. A solo owner subscribes with the base alone; the
  seat item is added later by `syncTeamSeats` once a teammate joins. The
  `atlas_team` product lands in `workspace_products` exactly as in
  `ActiveSubscriber` (Phase 5).
- **Invites:** now enabled. `inviteWorkspaceMember` enforces the
  `max_members` cap (50) by counting current members **plus** pending
  invitations; at the cap it throws and asks the admin to remove a
  member or cancel a pending invitation first.

### State: `InvitePending`

- An admin invited a teammate (Better Auth `createInvitation`). The
  invitation is outstanding and counts toward the cap, but **no seat is
  billed yet** — seat quantity tracks accepted membership, not pending
  invites.
- Admins can cancel a pending invitation (`cancelWorkspaceInvitation`),
  which frees a cap slot.

### State: `SeatReconciled`

- **Trigger:** the invitee accepts. Following the emailed link lands them
  on `/accept-invitation/{invitationId}`, which auto-accepts the
  invitation once the viewer is authenticated (signing them up / in
  first if needed) — a one-click join. Operators who are already signed
  in can also accept from `/organization` (the `PendingInvitations`
  surface).
- **Effect:** membership grows by one and `syncTeamSeats` reconciles the
  Stripe subscription so the seat line item's quantity equals
  members − 1, prorated for the partial period. The same reconciliation
  runs when a member is removed (`removeWorkspaceMember`) or leaves
  (`leaveWorkspace`), so billed seats always follow membership.
- **Source of truth:** Stripe holds the billed seat count; there is no
  seat-count column in Atlas. `syncTeamSeats` is idempotent and a no-op
  when the workspace has no active Team subscription.

## Resolved gaps

The follow-up gaps identified during the initial OOBE pass have been
addressed:

1. **CTA intent preserved through sign-in.** The pricing page now encodes
   `{intent, interval}` into the sign-in redirect target as URL search
   params (`URLSearchParams`-built). After the magic-link callback drops
   the viewer back on `/pricing`, an effect auto-resumes
   `startCheckout` once and clears the params via `replace: true`
   navigation.
2. **Provisioning page added.** Stripe `success_url` now points to
   `/checkout-complete?product={product}`. The page polls the session
   until the purchased product appears in `activeProducts`, then
   redirects to `/account`. A 30-second timeout shows a recoverable
   "we'll catch up" message.
3. **Discovery upgrade prompt.** `/discovery` shows an inline upgrade
   prompt for free-tier users, and a stronger "discovery runs are
   paused" prompt if the `research.run` capability is missing for any
   reason. Both link to `/pricing`.
4. **Pass expiration.** Already handled in `queryActiveProducts`
   (`workspace-products.ts`): the SQL filter ignores rows whose
   `expires_at` has passed. No scheduler needed.
5. **Webhook event ordering.** Migration v2 adds `stripe_event_at` to
   `workspace_products`. The upsert and subscription-status update
   queries skip writes when the inbound event is older than the stored
   timestamp.
6. **Free-tier copy.** The Free PlanCard tagline and feature list now
   distinguish "browse without an account" from "sign up to run
   research / save shortlists," eliminating the implication that
   anonymous users get research runs.

## Files of record

| Concern | Path |
|---|---|
| Pricing page UI | `app/src/domains/billing/pages/public/pricing-page.tsx` |
| Product catalog (price IDs) | `app/src/domains/billing/products.ts` |
| Capability resolver (TS) | `app/src/domains/access/capabilities.ts` |
| Capability resolver (Py) | `api/atlas/domains/access/capabilities.py` |
| Checkout server function | `app/src/domains/billing/checkout.functions.ts` |
| Stripe Checkout Session creator | `app/src/domains/billing/server/checkout.ts` |
| Team seat sync (Stripe) | `app/src/domains/billing/server/team-seats.ts` |
| Webhook dispatcher | `app/src/domains/billing/server/webhook-handler.ts` |
| Webhook route | `app/src/routes/api/stripe/webhook.ts` |
| `workspace_products` schema | `app/src/domains/access/server/atlas-migrations.ts` |
| `queryActiveProducts` | `app/src/domains/access/server/workspace-products.ts` |
| Session/state load | `app/src/domains/access/server/organization-session.ts` |
| Sign-up | `app/src/routes/_auth/sign-up.tsx` |
| Account setup | `app/src/domains/access/pages/auth/account-setup-page.tsx` |
| Workspace creation, invites, seat reconciliation | `app/src/domains/access/organizations.functions.ts` |
| One-click invite acceptance (`/accept-invitation/{invitationId}`) | `app/src/domains/access/pages/auth/accept-invitation-page-helpers.ts` |
| Stripe customer pre-creation | `app/src/domains/billing/server/stripe-customer.ts` |
| Discount coupons | `app/src/domains/billing/server/discount-coupons.ts` |
| Pricing model spec | `docs/superpowers/specs/2026-04-21-pricing-model-design.md` |

## Verification

To confirm the documented states match runtime behavior end-to-end
(manual walkthrough on a dev environment with Stripe test mode):

1. **Anonymous → pricing → CTA → sign-in redirect.** In an incognito
   window, visit `/pricing`, click "Get Atlas Pro" → confirm redirect to
   `/sign-in?redirect=/pricing`.
2. **Sign-up → account setup → workspace.** Submit a fresh email, click
   magic link, register a passkey → confirm landing on `/discovery` and
   a new row in Better Auth `organization` table with
   `workspaceType='individual'` metadata.
3. **Checkout (subscription).** From `/pricing`, choose Atlas Pro
   monthly → confirm Stripe Checkout opens with the Pro monthly price
   and `metadata.workspace_id` is set on the session.
4. **Webhook.** Use
   `stripe listen --forward-to localhost:3000/api/stripe/webhook` and
   complete checkout with test card `4242…` → confirm a
   `workspace_products` row with `status='active'` is upserted and org
   metadata gains `stripeCustomerId`.
5. **Capability hydration.** Refresh the app → confirm
   `useAtlasSession().data.workspace.activeProducts` includes
   `atlas_pro` and Discovery page no longer disables the Run button at
   limit.
6. **Cancel.** Open Customer Portal → cancel → confirm
   `customer.subscription.deleted` flips row to `cancelled` and
   capabilities revert.
7. **Pass.** Buy `atlas_research_pass` 7d → confirm `mode='payment'`,
   row inserted with `status='active'`, and check whether `expires_at`
   is populated and whether reads filter on it.

If any step diverges from the documented states, treat it as either a
code bug or a spec correction and update accordingly.
