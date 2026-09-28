# Atlas paid-launch acceptance — production v2026.09.27-21

Assessed September 28, 2026 at 03:05 UTC. Production release
[`v2026.09.27-21`](https://github.com/RebuildingAmerica/atlas/actions/runs/36370886771)
deployed commit `3139be61b687d04467284cd6923fabc7295c7b17` and passed release
CI, hosted smoke, and signed-in identity checks. The hosted checkout job
completed, but its live-session step was skipped because the repository checkout
flag is `false`. The
[read-only billing inventory](https://github.com/RebuildingAmerica/atlas/actions/runs/36372295127)
ran against that exact release and intentionally returned **NO-GO**. It moved no
money and changed no Stripe or Vercel settings.

## Decision

**Keep new paid sales closed.** The deployed Stripe key, charge-enabled account,
Tax status, and catalog IDs passed protected runtime inspection. The Atlas
customer portal configuration is missing. The billing webhook does not subscribe
to `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `refund.created`, or `refund.updated`.
Vercel Production has no `ATLAS_BILLING_ALLOWED_OFFERS` setting. Checkout
remains disabled. A passing runtime metadata check would still not prove an
authentic signed webhook delivery, a purchase, or the customer's ability to
cancel.

`b4ee7eed` adds a regression-tested correction for revoking access when multiple
partial refunds together return the full charge. That commit is on `main`, **not
in this assessed production release**. No refund behavior is marked as accepted
because of that local code change.

## Required purchase and exit journeys

| Journey                                | Status on v21     | Evidence needed to change status                                                                                                                                                                                                         |
| -------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every offered plan, interval, discount | Unverified        | For each offer enabled for sale, confirm live Checkout line items, amount, currency, Tax, term, and renewal against the published promise. The current offer allowlist is absent.                                                        |
| New paying individual                  | Unverified        | Normal email/passkey signup, preserved plan intent, genuine buyer payment, receipt, return, entitlement, and later sign-in on the same release.                                                                                          |
| Organization purchase                  | Unverified        | Hosted owner/admin purchase for the intended workspace and server-side denial for a member or a different workspace.                                                                                                                     |
| Team seats                             | Unverified        | Hosted invite, acceptance, seat addition/removal, proration, limits, and renewal-total acceptance against Stripe.                                                                                                                        |
| Declined or canceled Checkout          | Unverified        | No paid entitlement after either outcome; visible retry retaining the selected plan and work.                                                                                                                                            |
| Delayed settlement                     | Fail prerequisite | The deployed webhook endpoint is missing both async-payment events. Demonstrate no early fulfillment, success activation, and failure handling before enabling delayed methods.                                                          |
| Webhook delay, retry, and reordering   | Fail prerequisite | Add the missing events, verify the deployed signing secret with an authentic delivery, then demonstrate duplicate-safe and out-of-order reconciliation.                                                                                  |
| Cancellation and renewal failure       | Fail prerequisite | Provision and verify the Atlas customer portal, then demonstrate end-of-term cancellation, renewal failure, grace, and eventual access loss.                                                                                             |
| Research Pass expiry                   | Unverified        | Complete a paid pass and observe access end at its promised time, with saved-work behavior checked.                                                                                                                                      |
| Refund                                 | Fail prerequisite | Subscribe to refund events, deploy the cumulative-refund fix, exercise an authorized refund against an attributable purchase, and observe audit record plus access revocation.                                                           |
| Portal and receipts                    | Fail prerequisite | Provision the Atlas portal configuration and verify authorized access, invoice history, payment-method updates, and cancellation in a buyer account.                                                                                     |
| Production operation                   | Fail              | Checkout is closed; the offer allowlist and portal ID are absent. Runtime key, charge capability, Tax, and catalog ID checks passed, but write permissions, catalog amounts, signing-secret match, and full lifecycle remain unverified. |

These statuses follow the acceptance matrix in the
[billing audit](2026-09-23-billing-readiness.md). A test-mode session or a live
session URL is not a completed sale. The free public launch has a separate
[product gate](2026-09-23-product-launch-audit.md).
