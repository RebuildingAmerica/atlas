# Atlas Launch Safety and Billing Design

## Status

Approved program direction: September 23, 2026

Implementation status: design only

## Purpose

Atlas will launch a focused public discovery experience before the 2026 midterms
and will sell only products whose complete payment lifecycle has been proved.
The promoted content slice is Las Vegas housing and transportation/transit. The
national catalog remains searchable, but Atlas will not describe it as
nationally complete or uniformly useful.

This design defines the safety foundation that must land before broader public,
profile, organizer, or organization-admin UX work. It makes five promises true:

1. A person can report an incorrect or sensitive record without publishing the
   report's private explanation.
2. Only workspace owners and admins can open that workspace's billing portal.
3. Atlas grants paid access only after Stripe reports settled payment.
4. A granted refund reliably ends the refunded access term and leaves an audit
   trail.
5. Production sales can be enabled offer by offer only after the deployed offer
   passes a complete acceptance matrix.

These guarantees protect the experience directly. People must be able to trust
that a correction will not expose them, and buyers must never receive the wrong
access, lose track of a refund, or discover that another member can control
billing.

## Program Decomposition

The launch audit spans several independently testable product areas. They will
be delivered in this order:

1. **Launch safety and billing** — this specification.
2. **Public discovery** — mobile search, compact results, coherent list/map
   behavior, truthful result and coverage language.
3. **Profiles and evidence** — shorter decision-oriented profiles, visible
   claim-level sources, accurate dates, relationships, and useful next steps.
4. **Organizer and team work** — preserved save intent through signup, shortlist
   recovery, invitations, roles, ownership, and billing handoffs.
5. **Launch operations** — the reviewed Las Vegas query set, correction and
   support ownership, real-device acceptance, monitoring, and release go/no-go.

Each later area receives its own design and implementation plan. Public sales
remain disabled until this specification's application and production gates
pass. Public browsing may proceed independently once its privacy and content
gates pass.

## Existing System Boundaries

The design keeps the current boundaries:

- FastAPI owns public catalog and moderation endpoints.
- TanStack Start owns authentication, workspaces, checkout, billing state, and
  the Stripe webhook.
- Stripe owns payment collection, refunds, subscriptions, invoices, and the
  customer portal.
- `workspace_products` remains the source Atlas reads when resolving paid
  capabilities.
- `purchase_intents` remains the durable link between a user-selected offer,
  workspace, and Checkout Session.
- Existing event-time ordering continues to prevent older Stripe events from
  replacing newer local state.

No new billing service or queue is introduced. The webhook, success-page
reconciler, and a small operator refund command share the same settlement and
revocation functions so their behavior cannot drift.

## 1. Private Correction Reports

### Public contract

`POST /api/entity-flags` and `POST /api/source-flags` remain anonymous and
rate-limited. A successful submission returns a receipt containing only:

- the report identifier;
- its initial status;
- its creation time.

The receipt excludes the free-text note, target identifier, reviewer state, and
all other submitted fields. The public UI needs only confirmation that Atlas
received the report.

### Reviewer contract

`GET /api/entity-flags` and `GET /api/source-flags` require the existing
`discovery:write` permission. Authorized reviewers receive the full report,
including its note, target, reason, status, and timestamps. Resolve and dismiss
routes retain the same permission and full internal response.

The API uses separate Pydantic models for the public receipt and reviewer
record. A single response model must not serve both audiences. Generated OpenAPI
and TypeScript clients are regenerated after the contract changes.

### Privacy behavior

- Anonymous callers cannot list reports.
- A submitter cannot retrieve a note by using the identifier returned in the
  receipt.
- Existing reports receive the same protection; this is an API boundary change
  and requires no data migration.
- Responses retain `Cache-Control: no-store`.
- Invalid targets continue to return `404` without creating a report.

## 2. Workspace Billing Authority

The server checks the active workspace membership before creating a customer
portal session. The authorization rule is the same rule already used for managed
workspace checkout:

- owner: allowed;
- admin: allowed;
- member: denied;
- missing or stale membership: denied;
- membership in a different workspace: denied.

The reusable managed-billing-workspace guard will live in one billing server
module and will be used by purchase onboarding, portal creation, refund
operations, and future billing administration. It returns the verified active
workspace and role; callers do not reconstruct authority from client state.

The account UI hides billing-management actions from members, but the
server-side guard is authoritative. A denied request returns a plain user-facing
authorization error and never calls Stripe.

## 3. Settled-Payment Fulfillment

### One fulfillment function

Checkout webhook delivery and success-page reconciliation call one idempotent
function with a retrieved Checkout Session and Stripe event time. The function
validates all of the following before changing access:

- `payment_status` is `paid`;
- `workspace_id`, `product`, and purchase-intent metadata are present and
  internally consistent;
- the purchase intent belongs to that workspace and product;
- the product and interval are recognized;
- the Checkout Session has not been attributed to another purchase.

Only then does it upsert `workspace_products`, mark the purchase intent paid,
and attach the Stripe customer to the workspace. Repeated delivery is a no-op
with the same resulting state.

### Stripe event behavior

- `checkout.session.completed` fulfills immediately only when its
  `payment_status` is `paid`.
- An unpaid completed session changes no entitlement and leaves the purchase
  recoverable.
- `checkout.session.async_payment_succeeded` invokes the same fulfillment
  function.
- `checkout.session.async_payment_failed` records the failed attempt without
  paid access and leaves the selected offer available for a new Checkout
  attempt.
- The success-page reconciler retains its current paid-state check and calls the
  same fulfillment function.
- Subscription events continue to synchronize ongoing subscription state, but a
  newly created subscription cannot grant initial access before its Checkout
  payment settles.

### Durable provider references

`purchase_intents` is extended with nullable provider references needed for
reconciliation and refunds:

- Stripe PaymentIntent identifier;
- Stripe subscription identifier;
- paid timestamp;
- revoked timestamp;
- revocation reason.

The existing Checkout Session identifier remains unique. SQLite and PostgreSQL
migrations add the same columns and indexes. These identifiers are internal and
never rendered in public UI or error messages.

## 4. Refund and Access Revocation

### Supported refund rule

Atlas treats a full refund as reversal of the associated access term. Partial
refunds do not automatically revoke an entire term; they require an explicit
operator decision and are recorded as partial adjustments. This distinction
prevents a small courtesy refund from silently removing all access.

### Operator workflow

A repository-owned command accepts a Checkout Session identifier and performs
the refund for the associated purchase. It:

1. loads the Checkout Session and local purchase intent;
2. verifies account mode, workspace, product, amount, currency, and current
   refund state;
3. for a subscription, cancels it immediately before refunding the applicable
   paid invoice;
4. for a one-time Research Pass, refunds its PaymentIntent;
5. writes a durable billing adjustment with provider refund identifier,
   purchase, workspace, product, amount, currency, actor, reason, and time;
6. revokes the corresponding `workspace_products` term;
7. prints a redacted result suitable for the support record.

The command requires an operator identity and reason. It refuses ambiguous,
cross-workspace, already-refunded, wrong-mode, or partially paid purchases. It
supports a read-only preview so an operator can review the exact purchase before
the provider mutation.

Provider mutation still requires an authorized human to run the non-preview
step. Secrets stay in the runtime environment and never appear in command
arguments or output.

### Webhook convergence

The webhook handles the corresponding refund and subscription events so the
system converges if the command succeeds at Stripe but exits before its local
write. Refund handling uses stored PaymentIntent or subscription references to
locate the purchase. Full refunds set the workspace product status to
`refunded`, stamp revocation on the purchase intent, and append an idempotent
billing adjustment. Duplicate refund events do not duplicate records.

If an event cannot be attributed safely, the handler fails the delivery so
Stripe retries and operators can investigate. It must not guess a workspace or
revoke a product based only on a customer identifier.

### Billing adjustment record

An append-only `billing_adjustments` table stores the audit record. Its unique
provider event/refund identifiers provide idempotency. Records are retained when
a workspace product later changes state; they document what happened without
becoming the capability source of truth.

## 5. Offer-Level Sales Gate

The global checkout-open flag remains the emergency stop. A second explicit
production allowlist identifies each offer permitted for new sales by product
and interval. Examples are `atlas_pro:monthly` and `atlas_research_pass:weekly`.

Checkout creation refuses an offer absent from the production allowlist before
calling Stripe. Pricing presents an unavailable offer without a purchase action.
Test and local environments can exercise the complete catalog, but production
has no implicit all-offers default: a missing or malformed allowlist closes new
sales.

An offer enters the allowlist only after every applicable acceptance row passes
against the exact release. Pro monthly does not authorize Pro annual, Team,
Research Passes, seat add-ons, or discounts.

## 6. Production Verification

### Automated verifier

The existing billing bootstrap and verification scripts are extended to emit a
redacted, dated readiness report tied to the deployed Git revision. They verify:

- Stripe account and live/test mode;
- runtime key access to every Stripe operation Atlas uses;
- every referenced product, price, coupon, and seat price belongs to that
  account and mode;
- enabled webhook URL, event set, and recent successful delivery;
- customer portal cancellation, invoice, and payment-method capabilities;
- automatic-tax configuration required by enabled Checkout behavior;
- deployed checkout flag and offer allowlist;
- catalog consistency between runtime configuration and enabled offers.

The verifier never prints secrets and never equates endpoint metadata with proof
that the deployed signing secret matches. A signed delivery received by the
deployed webhook is separate evidence.

### Acceptance report

The release artifact contains pass, fail, or unverified for every row in the
billing audit's acceptance matrix. Each pass links to evidence for the exact
release and offer. A Checkout Session opening is recorded only as session-open
proof.

Automated test-mode purchases cover customer entry, return, entitlement,
decline/cancel, async settlement, retries and ordering, cancellation, expiry,
seats, and refund/revocation. Production acceptance additionally requires an
authorized buyer to perform one genuine purchase for each offer category being
opened. Automation may prepare and observe that test but does not submit a live
payment or refund without the buyer/operator.

### Key rotation

The production key is rotated only for a confirmed access or security reason.
Before any change, the verifier inventories the current account and catalog.
After a change, the complete report and enabled-offer acceptance are rerun. A
successful key check alone cannot open sales.

## Error Handling and Recovery

- Webhook signature failures return `400` and change no state.
- Invalid or incomplete event metadata fails explicitly; no entitlement is
  inferred.
- Database failure after provider success returns a retryable webhook failure.
- Database writes use provider identifiers and event time for idempotency and
  ordering.
- Checkout cancellation and async failure preserve purchase intent so the user
  can retry the same selected offer.
- Portal and refund authorization failures occur before Stripe calls.
- The global checkout flag closes all new sales without removing existing paid
  access or portal access.
- The offer allowlist closes only new sales for the affected offer.

## Testing Strategy

Implementation follows test-driven development.

### API behavior

- Anonymous flag submission returns a receipt with no submitted note.
- Anonymous report listing returns an authorization failure.
- Authorized reviewers can list full reports and resolve or dismiss them.
- Existing rate limiting, missing-target behavior, pagination, and no-store
  headers remain covered.

### Billing authorization

- Owner and admin can create a portal session for the active workspace.
- Member, missing membership, and cross-workspace access are rejected before a
  Stripe call.
- Billing-management UI follows the same role rule.

### Payment lifecycle

- Paid synchronous completion grants access exactly once.
- Unpaid completion grants nothing.
- Async success grants access exactly once; async failure grants nothing.
- Success-page reconciliation and webhook delivery converge to one state.
- Missing or conflicting metadata fails without cross-workspace access.
- Older and duplicate events cannot regress state.

### Refund lifecycle

- Preview makes no provider or database mutation.
- Full one-time refund revokes the pass and records one adjustment.
- Subscription refund cancels the subscription, revokes access, and records one
  adjustment.
- Provider-success/local-failure recovery converges through webhook retry.
- Partial, duplicate, wrong-mode, and unattributable refunds are handled by the
  explicit rules above.

### Release behavior

- Production refuses an absent, malformed, or unapproved offer allowlist.
- Disabled offers cannot create Checkout Sessions and have no purchase action.
- Verifier fixtures cover mismatched accounts, modes, catalog objects,
  permissions, portal settings, tax settings, webhook events, and delivery.
- The acceptance report schema requires a result and evidence reference for
  every matrix row.

Focused tests run first, followed by API formatting/lint/type checks and app
formatting/lint/type checks. Full API and app suites, OpenAPI generation drift,
and the billing acceptance suite must pass before the release candidate is
eligible for provider verification.

## Launch Gates for This Subproject

This subproject is complete only when all of the following are true:

- the correction privacy contract passes against the running API;
- portal authorization passes for owner, admin, member, and cross-workspace
  cases;
- synchronous and asynchronous settlement tests prove no unpaid access;
- an exercised test-mode refund proves provider refund, local revocation, and
  the audit record;
- production can close or open each offer independently;
- the redacted readiness report covers every billing matrix row for the exact
  deployed revision;
- a signed webhook delivery reaches that deployment;
- every production offer left enabled has its required genuine authorized
  purchase evidence.

Until those gates pass, the product may continue free public browsing, but it
must not claim paid-launch readiness. This specification does not authorize a
live charge, refund, credential rotation, deployment, or provider mutation.

## Explicit Non-Goals

This subproject does not redesign pricing, replace Stripe, add new products,
build a finance dashboard, automate tax registrations, or certify legal/tax
compliance. It also does not implement the later public discovery, profile,
organizer, team-management, or launch-operations designs. Its purpose is to make
the existing correction and payment promises safe enough for those experiences
to launch on top of them.
