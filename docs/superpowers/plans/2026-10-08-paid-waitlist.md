# Atlas paid-access waitlist implementation

Approved in chat October 8, 2026. Public discovery and free accounts remain
open. Email and plan are required; name, organization, and intended use are
optional. Staff selects confirmed applicants individually or in batches.
Approval permits purchasing only that product, persists until revoked, and never
grants paid features before payment settlement.

## Tasks

1. Build SQLite/PostgreSQL waitlist persistence, scoped seven-day links,
   persistent rate limits, admission grants, encrypted delivery records, and
   audit history. Exercise duplicate, confirmation, withdrawal, revocation, and
   database behavior.
2. Add public and staff server functions and confirmation/invitation/refresh
   emails, including explicit staff authorization and durable retry outcomes.
3. Build signup, confirmation, private status, invitation, and admin
   queue/detail screens; adapt pricing, onboarding and upgrade surfaces to
   admission state.
4. Enforce admission in current and legacy checkout, preserving existing
   customer billing, team invitations, offer gates, and settled-payment
   fulfillment.
5. Wire explicit managed deployment mode and turnkey configuration; run
   meaningful unit, integration, browser and coverage checks and obtain
   independent review.

## Defaults and acceptance

Approval is per person/product across managed workspaces. Existing paid
products, renewals and customer portals continue working; different products
require approval. Team members do not need separate approval. No automatic
admission or marketing/reminder campaigns. Link GETs do not mutate state.
Duplicate anonymous requests reveal no private status and cannot overwrite
confirmed details. Invitation delivery and approval are independent; sent means
provider accepted, not delivered. Sales-paused plans cannot be invited. Link
expiry never expires approval.

Runtime acceptance requires desktop/mobile keyboard-accessible signup → captured
confirmation → staff invitation → matching verified account → authorized
workspace → Stripe test payment → settled entitlement. Production inbox and
money-moving verification remain separate release gates.
