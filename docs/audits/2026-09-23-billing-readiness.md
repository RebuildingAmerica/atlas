# Atlas billing and launch operations audit — September 23, 2026

Read-only audit. No provider mutations, purchases, webhook deliveries,
deployments, or application edits were performed. Reviewed latest GitHub main
`58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a`, dated September 14, 2026, through
GitHub and a read-only archive of that revision. The supplied worktree is older,
August 2 `7b804be5`; findings below use the pinned current-main revision unless
explicitly qualified.

## Decision

Do not certify that changing only a Stripe API key is sufficient. Production
already passed a live-mode Pro monthly **session-creation** test on September
14; no card was submitted and no money moved. This is stronger evidence than an
unconfigured billing implementation. It is not payment-completion,
entitlement-delivery, cancellation, or refund proof. Existing configuration
should be verified before replacing keys or reprovisioning anything.

### What an API-key-only change would and would not do

- If the replacement key is valid, has every required permission, and belongs to
  the same live account as the catalog IDs, it can restore or preserve Stripe
  API access. It does not fix Atlas's billing-role authorization, unpaid-session
  fulfillment, refund/revocation procedure, or incomplete lifecycle acceptance.
- If the key belongs to another account or mode, the stored product, price,
  coupon, customer, subscription, and webhook identifiers will not form one
  usable billing system. Swapping the key without inventorying those objects can
  break a configuration that has historical evidence of opening live Checkout.
- The audit did not establish that the deployed key needs replacement. The
  invalid local CLI credential and the encrypted production runtime setting are
  different credentials. Rotate only for a confirmed security or access reason,
  then re-run the full acceptance matrix.

The minimum conclusion is therefore precise: **a key may be one required input,
but key-only readiness is disproven by source defects and missing payment
lifecycle evidence.**

## Verified evidence

- September 14 production release
  [34872955425](https://github.com/RebuildingAmerica/atlas/actions/runs/34872955425)
  passed full CI, deploy, hosted smoke, hosted identity, and
  `Prove production checkout opens a live Stripe session`.
- [The hosted checkout proof](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/tests/e2e/checkout-hosted.spec.ts#L77)
  covers Pro monthly, uses a prepared account/session, traverses onboarding to
  Stripe, and asserts `cs_live_`. It does not use a real person's normal signup
  or submit payment. Lines 8–9 explicitly stop at session creation.
- September 21 CI
  [35632551456](https://github.com/RebuildingAmerica/atlas/actions/runs/35632551456)
  failed secret scanning, with tests canceled. Latest main production release
  [34890210972](https://github.com/RebuildingAmerica/atlas/actions/runs/34890210972)
  failed at the same scanner and skipped deploy/hosted checks. This is not proof
  that production itself is unhealthy; the previous release passed.
- September 23 canary
  [35824634755](https://github.com/RebuildingAmerica/atlas/actions/runs/35824634755)
  passed. Its scope is app/sitemap/PDS HTTP status and nonempty catalog/transit
  search, not billing or meaningful research success.
- Read-only Vercel metadata, using the linked root app project, shows
  `STRIPE_API_KEY`, `STRIPE_ATLAS_CATALOG`, and `STRIPE_WEBHOOK_SECRET` present
  and encrypted in Production. This proves presence, not mode, matching
  account/catalog, or signing-secret correctness.
- GitHub repository variable `ATLAS_BILLING_CHECKOUT_ENABLED` is `true`. No
  production-environment Stripe secrets exist, but current deployment does not
  need them:
  [the current production workflow](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/.github/workflows/deploy-production.yml#L202)
  preserves bootstrap-provisioned Vercel Stripe values and checks presence. The
  runbook's claim that production-environment overrides are required is stale.
- Atlas-specific saved Stripe CLI live credential returned HTTP 401
  `Invalid API Key`; no secret values were exposed. Therefore the account's
  current live catalog, charge eligibility, Tax activation, portal settings, and
  webhook delivery cannot be certified from this session. The default CLI
  account belongs to a different business and was explicitly excluded from Atlas
  conclusions.

## Concrete source findings requiring attention

1. **Billing portal lacks the workspace billing role check.**
   [Portal session creation](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/billing/billing.functions.ts#L39)
   requires a signed-in user and active workspace with a Stripe customer, then
   creates a portal session. It does not check owner/admin authority.
   [The workspace billing UI](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/billing/components/workspace-billing-section.tsx#L40)
   shows the action for active products, also without role filtering. In
   contrast, purchase onboarding explicitly enforces
   `canManageAtlasOrganizationRole` in
   [purchase onboarding](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/billing/purchase-onboarding.functions.ts#L45).
   Apply the same server-side guard to the portal before confidently selling
   Team; verify a normal member cannot obtain the customer's portal URL.
2. **Payment completion is not covered by the passing acceptance gate.**
   [The billing runbook](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/docs/deployment/stripe-billing.md#L302)
   and
   [acceptance helper](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/tests/acceptance/domains/billing/oobe.spec.ts#L323)
   explicitly exclude card submission, redirect back, and genuine-payment
   webhook entitlement. Test-mode session creation for Pro/Team/Research Pass is
   useful but incomplete. A hosted payment-to-entitlement demonstration is the
   missing acceptance evidence, not another mocked unit test.
3. **Webhook activation does not verify paid state.**
   [The completion handler](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/billing/server/webhook-handler.ts#L193)
   marks a completed Checkout session active/paid without checking
   `payment_status`. The
   [success-page reconciler](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/billing/server/webhook-handler.ts#L268)
   does check `payment_status === 'paid'`. The
   [event dispatch](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/billing/server/webhook-handler.ts#L373)
   subscribes only to completed/subscription lifecycle events. Before enabling
   payment methods with delayed settlement, make the webhook payment boundary
   explicit and test successful/failed delayed settlement; current live
   payment-method configuration is unverified.
4. **Refund promise lacks a demonstrated entitlement reversal path.**
   [The public terms](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/platform/pages/terms-page.tsx#L46)
   promise that a refunded term ends paid access. The webhook dispatch handles
   no refund event
   ([event dispatch](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/billing/server/webhook-handler.ts#L373));
   no refund/revoke workflow was found in searched billing/bootstrap source.
   This does not establish that staff have no manual process. It does require a
   named, exercised operator procedure or implementation that makes the promise
   true, especially for one-time Research Passes.
5. **Restricted-key instructions are incomplete for the runtime surface.**
   [Restricted-key instructions](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/docs/deployment/stripe-billing.md#L152)
   list Products, Prices, Coupons, Customers, Checkout Sessions, Webhook
   Endpoints. Runtime also creates billing portal sessions
   ([source](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/billing/billing.functions.ts#L64)),
   reads subscriptions and creates/updates/deletes subscription items
   ([source](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/billing/server/team-seats.ts#L71)).
   Verify the replacement key's permissions for every operation, not just
   Checkout creation. No exact provider permission labels are asserted here.
6. **Cutover instructions disagree with implementation.**
   [The runbook](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/docs/deployment/stripe-billing.md#L79)
   claim production deploy overwrites Vercel with repository test secrets and
   requires production environment secrets; the
   [current workflow](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/.github/workflows/deploy-production.yml#L202)
   intentionally preserves Vercel. Reconcile the instructions with the actual
   owner of configuration before the next key change.

## Requirements beyond an API key

These may already exist; do not infer they are missing from lack of access.
Verify rather than recreate:

- Correct live Stripe account permitted to charge; a runtime key with Checkout,
  customer, portal, subscription, and seat-operation permissions.
- All live prices/products/coupons in `STRIPE_ATLAS_CATALOG`, same account and
  mode as the key. Pro monthly has historical live-session proof; other live
  plans/intervals/discounts do not have equivalent evidence in this audit.
- Enabled live webhook at the deployed `/api/stripe/webhook`, correct events,
  matching deployed signing secret, authentic event delivery and retry
  reconciliation.
  [The verifier](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/scripts/bootstrap/products/atlas/verify-webhook.ts#L51)
  checks endpoint status/event metadata, not a delivered signed event or
  signature-secret match.
- Stripe Tax configured for the intended sale; current Checkout defaults
  automatic tax on
  ([source](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/billing/server/checkout.ts#L45)).
  Account settings were not verified. No legal conclusion about registrations or
  liability is made here.
- Live customer portal configuration permitting the promised end-of-period
  cancellation and invoice/payment-method access; bootstrap has no
  portal-configuration setup in reviewed source.
- Deployed checkout-open flag and usable catalog; canonical onboarding enforces
  both. Presence of a single row proves availability, not paid product value.
- Successful purchase redirects, correct workspace entitlement, returning paid
  access, team seats/proration, cancellation through term end, renewal recovery,
  pass expiry, and promised refunds. The implementation contains these pieces to
  varying degrees but their combined provider behavior is unverified.

## Existing strengths

Bootstrap provisions catalog and webhook with mode validation and explicit
account confirmation; signing verification uses the raw request body; writes
protect against older webhook timestamps; the success page reconciles a paid
session when webhook delivery lags; subscription past-due access has a bounded
30-day grace
([source](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/access/server/workspace-products.ts#L49));
public terms now explain renewal, cancellation, refunds, and failed payments.
Preserve these rather than redesigning billing.

Source paths and lines above refer to
[the reviewed current-main revision](https://github.com/RebuildingAmerica/atlas/tree/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a),
not the older local checkout.

## Paid-launch decision sequence

1. **Contain known application defects.** Add the server-side billing-role
   check. Require paid state before entitlement or explicitly restrict live
   payment methods to ones whose completion semantics the handler supports.
   Establish and rehearse refund-to-revocation handling.
2. **Inventory the existing live account before changing credentials.** Record
   the account ID, key mode and permissions, catalog object IDs, active webhook
   endpoint/events, customer-portal configuration, automatic-tax state, and
   checkout flag in a redacted artifact. Confirm every referenced object belongs
   to that account and mode.
3. **Run the matrix below in test mode.** Cover normal customer entry and all
   failure/recovery seams, not only prepared-account session creation.
4. **Verify production without fabricating live charges.** Re-run catalog and
   session-opening checks against the exact deployed release, inspect authentic
   webhook delivery, and complete one genuine authorized purchase with the buyer
   performing the payment step. Confirm receipt, entitlement, returning access,
   cancellation or expiry, and the operator's refund path.
5. **Open only the offers that passed.** A working Pro monthly session does not
   approve Team seats, Research Passes, annual plans, or discounts. Keep any
   unproven combination unavailable for new sales until its evidence exists.

## Acceptance matrix for taking money

This is required evidence, not a claim that each behavior currently fails. Use a
controlled test environment for synthetic purchases and lifecycle events. Live
configuration inspection and a genuine authorized customer purchase are separate
acceptance steps.

| Journey                                | Minimum acceptance evidence                                                                                                                                                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every offered plan, interval, discount | Pricing, Checkout line items, amount/currency/tax, term, and renewal behavior agree. Validate Pro, Team, additional seats, both Research Pass durations, annual and advertised discounts; make unsupported new-sale options unavailable until ready. |
| New paying individual                  | Normal account/email/passkey setup, preserved plan intent, purchase, receipt, return, correct capability, and later sign-in work. Prepared internal authentication does not prove normal signup.                                                     |
| Organization purchase                  | Owner/admin can buy for the intended workspace; wrong workspace and unauthorized member are rejected.                                                                                                                                                |
| Team seats                             | Invitations, acceptance, added seats, removal, proration, limits, and displayed renewal total match policy. Failed changes leave coherent access and billing state.                                                                                  |
| Declined/canceled Checkout             | No false paid entitlement; clear retry; research and selected plan preserved.                                                                                                                                                                        |
| Delayed settlement                     | No fulfillment while unpaid; successful asynchronous payment activates exactly once; failure does not leave paid access. Restrict methods until supported if necessary.                                                                              |
| Webhook delay/retry/reordering         | Correct signing secret, authentic delivery, duplicate-safe state, no stale-event regression, paid-return reconciliation, and workspace isolation.                                                                                                    |
| Cancellation/renewal failure           | Access through the promised term, clear future-charge status, bounded grace, and correct eventual entitlement.                                                                                                                                       |
| Research Pass expiry                   | Access ends at the promised time without a recurring charge; underlying saved work follows the stated retention/access policy.                                                                                                                       |
| Refund                                 | Operator can locate the purchase, issue an authorized refund, revoke the refunded term as promised, and retain a minimal audit record. A manual procedure is acceptable only if reliable and exercised.                                              |
| Portal and receipts                    | Correct business identity, invoices, payment-method management, cancellation controls, and authorized access only.                                                                                                                                   |
| Production operation                   | Correct charge-enabled account; live identifiers from that account; runtime permissions for every used operation; automatic-tax prerequisites and portal settings verified; deployed webhook/configuration consistent.                               |

Produce a redacted, dated readiness report tied to the deployed version, with
pass/fail/unverified for every row. A session-creation test must not
automatically mark the payment lifecycle ready.

## Remaining access boundary

The available Atlas Stripe CLI credential was invalid and the relevant browser
required sign-in. That does not establish that production's independently
configured key is invalid. The audit did not charge a card, create an account,
rotate a key, or mutate provider configuration.

The Context7 documentation lookup exhausted its quota; this was reported during
the audit. Official Stripe documentation was consulted directly:
[go-live checklist](https://docs.stripe.com/get-started/checklist/go-live),
[Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), and
[testing](https://docs.stripe.com/testing). Context7 access can be restored with
`pnpm dlx ctx7@latest login` for subsequent implementation documentation.

Return to the
[product and launch assessment](2026-09-23-product-launch-audit.md).
