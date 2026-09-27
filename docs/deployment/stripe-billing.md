# Stripe Billing Setup

[Docs](../README.md) > [Deployment](./README.md) > Stripe Billing Setup

Atlas uses Stripe for the hosted Pro, Team, Research Pass, discount, and webhook
surfaces. This runbook keeps the Stripe catalog aligned across local
development, staging, and production.

## Product policy

The product rule is simple: nobody pays to see civic data, but people and
organizations using Atlas for funded work should pay for the hosted tools that
make that work easier. The public directory stays free. Individual researchers
can use Pro, Research Pass, or verified Pro discounts. Teams with shared seats,
SSO, or SCIM use Atlas Team at the standard Team price.

That policy matters operationally: Team keeps the standard Team price in every
environment. Discount coupons are scoped to Atlas Pro only.

## Catalog

The canonical catalog lives in `scripts/bootstrap/config/products.ts`.

| Stripe object                 | Canonical value                                               |
| ----------------------------- | ------------------------------------------------------------- |
| Atlas Pro                     | Product `pro`                                                 |
| Pro monthly price             | $5 every month                                                |
| Pro annual price              | $48 every year                                                |
| Pro student price             | $16 every 4 months before coupon                              |
| Student coupon                | 20% off Pro, yielding $12.80 every 4 months                   |
| Creator and journalist coupon | 50% off Pro monthly or annual                                 |
| Grassroots nonprofit coupon   | 40% off Pro monthly or annual                                 |
| Civic tech coupon             | 50% off Pro monthly or annual                                 |
| Atlas Team Base               | $25 every month or $250 every year                            |
| Atlas Team Seat               | $8 per seat every month or $80 per seat every year            |
| Atlas Research Pass           | $9 for 30 days or $4 for 7 days, charged as one-time payments |

The student price intentionally pairs a four-month recurring price with a
student-only coupon. The net charge is $12.80 every four months, or $38.40 per
year, which is 80% of annual Pro paid in three installments.

Research Pass matches Team-level individual quota and access for its duration:
unlimited research, unlimited shortlists and notes, export, MCP/OAuth,
watchlists, unlimited API keys, and 10,000 requests per day per key. It does not
grant shared seats, SSO, or SCIM.

## Runtime keys

Every local, staging, and production runtime needs the same three Stripe keys.
Values are mode-specific; never copy test catalog values into live mode or live
catalog values into test mode.

```env
STRIPE_API_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_ATLAS_CATALOG=
```

A fourth variable decides whether Atlas sells at all:

```env
ATLAS_BILLING_CHECKOUT_ENABLED=false
ATLAS_BILLING_ALLOWED_OFFERS=
```

Both must be set in production. The offer list is a comma-separated set of exact
product and interval pairs, for example `atlas_pro:monthly`. Supported pairs are
`atlas_pro:monthly`, `atlas_pro:yearly`, `atlas_pro:four_month`,
`atlas_team:monthly`, `atlas_team:yearly`, `atlas_research_pass:weekly`, and
`atlas_research_pass:once`. An absent, duplicate, or unknown offer closes every
new production sale. Keep an offer out of this list until its own purchase,
entitlement, cancellation or expiry, and refund checks pass. Removing an offer
stops new sales without removing an existing customer's access.

Unset means closed, because an operator who has not chosen to sell should not be
selling. Turning both on is not sufficient on its own. Checkout also probes the
catalog API for one real entry before it will create a purchase intent or a
Stripe Checkout session, so a reachable API with an empty directory keeps the
funnel shut. A shallow `/health` check would pass in exactly the case that
matters, which is why the probe asks for data instead.

The staging deploy exports it as `true` so staging exercises the paid funnel.
Production reads the `ATLAS_BILLING_CHECKOUT_ENABLED` repository variable and
falls back to `false` when it is unset. Set that variable to `true` only after
`https://atlas.rebuildingus.org/browse` returns results.

## Staging to production cutover

The production deploy preserves the Vercel Stripe variables provisioned by
`pnpm setup:prod`; when checkout is enabled, it checks that the key, catalog,
webhook secret, and offer allowlist are named in Vercel Production **before**
deploying the API or PDS. A missing setting stops the release without a partial
deployment. This is a presence check, not validation of values or payment. The
repository's test-mode Stripe secret belongs to CI and is not copied into the
production runtime. The deploy passes its checkout flag with the deployment,
while the catalog, key, signing secret, and offer allowlist live in Vercel.

The cutover requires these settings; it does not certify the payment lifecycle:

1. Confirm `STRIPE_API_KEY`, `STRIPE_ATLAS_CATALOG`, and `STRIPE_WEBHOOK_SECRET`
   are present in Vercel Production after live bootstrap. Confirm their values
   belong to the same live account and deployed webhook.
2. Set `ATLAS_BILLING_ALLOWED_OFFERS` in the production app runtime to only the
   offers whose acceptance rows have passed. Confirm the deployed pricing page
   enables exactly those offers.
3. Set the `ATLAS_BILLING_CHECKOUT_ENABLED` repository variable to `true`.

Do the third only after `https://atlas.rebuildingus.org/browse` returns useful,
reviewed results. The catalog probe enforces that at runtime regardless, but the
variable is the deliberate decision.

## Sales tax

Checkout sessions enable Stripe Tax, let Stripe collect whatever address it
needs, and offer tax ID collection so an organisation can put its VAT or GST
number on the invoice. Address collection is `auto` rather than `required`: for
a US card Stripe asks for country and postal code, which is enough to rate the
sale, while `required` renders a full street form backed by Google Places
autocomplete and costs every buyer an extra step. Postal-level rating is
standard for SaaS at these prices. Stripe rejects `automatic_tax` against a
saved customer unless the session may write the address back, which is why
sessions with a customer also send `customer_update`.

This requires Stripe Tax to be activated on the account, in the same mode as the
key in use, with a registration for every jurisdiction Atlas collects in.
Activate it under **Stripe Dashboard > Tax**, confirm the origin address, and
add registrations before the first live charge. Stripe rejects session creation
when Tax is enabled in the request but not active on the account, so this fails
loudly rather than under-collecting.

```env
ATLAS_BILLING_AUTOMATIC_TAX=true
```

The default is on, and only the exact string `false` turns it off. Turning it
off means Atlas charges without calculating or remitting sales tax, which is a
liability from the first charge rather than at scale. Use it only as a
short-lived measure on an account that has not finished Tax activation.

Bootstrap stamps every product with the `txcd_10103000` Software as a Service
tax code, and backfills products created before Atlas set one. Confirm that code
suits the catalog before the first live charge.

`STRIPE_ATLAS_CATALOG` is generated by bootstrap after it creates or verifies
the canonical Stripe products, prices, and coupons. Bootstrap writes the catalog
as one generated value so the app reads one Stripe contract. The individual
Stripe IDs are catalog internals, not operator-managed configuration.

## Setup path

Stripe setup is part of the repo bootstrap. Use the target setup command first;
this runbook explains the Stripe portion when something needs inspection.

Before running hosted setup:

1. Install and authenticate the Stripe CLI with `stripe login`.
2. Link the Vercel project for hosted staging and production env sync.
3. Set `ATLAS_PUBLIC_URL` for the target environment.
4. For production, open Stripe Dashboard in Live mode, go to **Developers > API
   keys > Restricted keys**, click **Create restricted key**, choose **Powering
   an integration you built**, and name it `Atlas Production Billing`. Use this
   key for Atlas website and app code. Set permissions:
   - **Read:** Accounts v2, shown by Stripe errors as Basic Business Contact
     Information (`accounts_kyc_basic_read`)
   - **Write:** Products, Prices, Coupons, Customers, Checkout Sessions, Webhook
     Endpoints

   A live secret key (`sk_live_...`) is accepted, but restricted keys are the
   default production path. Include the runtime and refund permissions listed in
   the Production section below; Checkout creation alone is insufficient.

Stripe CLI OAuth keys are the default for test-mode local and staging
operations. Production bootstrap uses a Dashboard-created live restricted key
because the hosted app needs the same live runtime key to create Checkout
sessions.

## Local development

Run the local setup:

```bash
pnpm setup:local
```

This writes Stripe values to `.env` and `app/.env.local` and syncs the test-mode
catalog.

Keep webhook delivery open while testing Checkout locally:

```bash
pnpm stripe:listen
```

The script reads `ATLAS_PUBLIC_URL` from `.env`, defaults to
`https://atlas.localhost`, and forwards these events to
`<local-origin>/api/stripe/webhook`:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `refund.created`
- `refund.updated`

## Staging

Staging uses Stripe test-mode objects and Vercel Preview environment variables:

```bash
pnpm setup:staging
```

(`pnpm bootstrap --target staging` is the same command under a different alias.)
It writes `.env.staging`, creates or verifies the Stripe test-mode catalog,
creates or verifies the staging webhook endpoint, and syncs the three runtime
Stripe keys into the linked Vercel Preview environment. It also runs
Infrastructure, Database, and Deploy against staging's own GCP project and Neon
database — see [Staging Deployment](./staging.md). MCP Registry is the one phase
that stays production-only: publishing to a public MCP registry has no staging
equivalent, so a staging-targeted run always skips it.

## Production

Production uses Stripe live-mode objects and Vercel Production environment
variables:

```bash
pnpm bootstrap
```

If you do not have the live key yet:

1. Open Stripe Dashboard and switch to Live mode for The Rebuilding America
   Project.
2. Go to **Developers > API keys > Restricted keys**.
3. Click **Create restricted key**.
4. Choose **Powering an integration you built**.
5. Name the key `Atlas Production Billing`.
6. Set permissions for bootstrap and runtime operations:
   - **Read:** Accounts v2, shown by Stripe errors as Basic Business Contact
     Information (`accounts_kyc_basic_read`)
   - **Read:** Charges, PaymentIntents, Invoices, Invoice Payments,
     Subscriptions, Refunds, and Billing Portal configuration.
   - **Write:** Products, Prices, Coupons, Customers, Checkout Sessions,
     Subscriptions, Refunds, Billing Portal sessions, and Webhook Endpoints.
     Confirm the exact permissions available for the installed Stripe API
     version in the account's restricted-key UI. A key that can create Checkout
     Sessions but cannot read invoice payments or create refunds is
     insufficient.
7. Reveal the key once, copy the `rk_live_...` value, and keep it out of chat
   and committed files.
8. Run `STRIPE_API_KEY=rk_live_... pnpm setup:prod --yes`.

`Accounts v2: Read` lets bootstrap show the friendly Stripe account name before
it changes billing objects. If the restricted-key UI does not expose that
permission, bootstrap can continue after Stripe returns the account ID and you
confirm the ID belongs to The Rebuilding America Project.

The command writes `.env.production`, creates or verifies the Stripe live-mode
catalog, creates or verifies the production webhook endpoint, and syncs the
three runtime Stripe keys into the linked Vercel Production environment.

The script checks test/live mode before mutating Stripe and stops when a key
does not match the selected target.

For interactive shells, omit `--yes` while still passing the live key:

```bash
STRIPE_API_KEY=rk_live_replace_me pnpm setup:prod
```

## Verification

After each bootstrap run, verify the app-facing contract:

```bash
pnpm bootstrap:test
cd app && pnpm vitest run tests/unit/domains/billing/checkout/functions/guards.test.ts tests/unit/domains/billing/checkout/functions/prices.test.ts tests/unit/domains/billing/server/discount-coupons.test.ts
```

Then verify the target Stripe catalog from the env file Atlas will actually
load:

```bash
pnpm stripe:verify:local
pnpm stripe:verify:staging
STRIPE_API_KEY=rk_live_replace_me pnpm stripe:verify:prod
```

Run only the target you just bootstrapped. The verifier checks required env
keys, product IDs, price amounts and intervals, product-scoped coupons, and
inactive or missing Stripe objects without printing secrets. For staging and
production it also checks that Vercel has the three hosted Stripe runtime keys
for the requested target and, for production, the offer allowlist variable. It
checks that the Stripe billing webhook endpoint exists for `ATLAS_PUBLIC_URL`,
is enabled for the canonical billing events, and carries the Atlas billing
webhook metadata. Env-key presence cannot prove the deployed allowlist value,
signing-secret match, runtime key permissions, tax setup, or successful payment
and refund. Record those separately before sales open.

If you want to inspect Vercel's encrypted env metadata directly:

```bash
vercel env ls --scope rebuilding-america-project --cwd app
```

### Read-only production inventory

Run the manual **Production Billing Readiness** workflow against the latest
deployed tag before deciding whether any live offer can open:

```bash
gh workflow run billing-readiness.yml --ref main -f release_tag=vYYYY.MM.DD-N
```

The job runs against the existing Vercel Production variables in memory, then
queries Stripe for the charge-enabled account, canonical
products/prices/coupons, webhook endpoint configuration, Tax settings, and
default customer-portal controls. Its GitHub job summary is deliberately
redacted: it shows check outcomes and only the final four characters of the
account ID. The job fails while checkout is closed or any required proof is
failed or unverified. A failed run is therefore an honest **no-go** result, not
automatically a broken script. It never changes Stripe, Vercel, or the checkout
flag.

This inventory still cannot prove that the deployed signing secret matches a
delivered webhook, that the runtime key has write/refund permissions, that Tax
registrations fit the intended sales, or that a buyer received and later lost
paid access correctly. Record those separate acceptance results against the same
release before opening an offer.

The expected state is:

- `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_ATLAS_CATALOG` are
  present for the target environment.
- `ATLAS_BILLING_ALLOWED_OFFERS` is present in production and contains only
  acceptance-tested offers; the deploy's checkout flag matches the release
  decision.
- `STRIPE_ATLAS_CATALOG` contains the student four-month Pro price and the
  discount coupon IDs.
- Every discount coupon applies only to the Atlas Pro Stripe product.
- The hosted Stripe webhook endpoint points at
  `<ATLAS_PUBLIC_URL>/api/stripe/webhook` and listens for the canonical billing
  events.
- Team checkout never attaches student, creator/journalist, nonprofit, or civic
  tech coupons.
- Research Pass checkout stays a one-time payment and never grants SSO or SCIM.

## Refund and access recovery

Use the repository command for a full refund of a purchase created through
Atlas's purchase onboarding. It reads the current Stripe charge and local
purchase before doing anything. The default invocation is a read-only preview:

```bash
cd app
pnpm billing:refund --session cs_...
```

Review the printed account mode, workspace, product, amount, currency, and
subscription. Match them to the support request and original purchase. Then an
operator whose email is in `ATLAS_OPERATOR_ALLOWED_EMAILS` can run:

```bash
pnpm billing:refund --session cs_... --operator operator@example.org --reason "Customer request" --execute
```

The command refuses an unpaid, mismatched, previously revoked, already or
partially refunded, or unattributable purchase. For a subscription it cancels
future billing before issuing the refund. It uses a stable Stripe idempotency
key for retries. A succeeded refund writes one adjustment and revokes only the
term linked to the purchase; a pending refund waits for the signed webhook. The
webhook also reconciles full refunds created outside the command when it can
attribute them to one paid purchase. Partial refunds are recorded without
automatically ending access. If a refund cannot be attributed, the webhook fails
so Stripe retries and the operator can investigate.

The command needs runtime access to the same Stripe account and Atlas auth
database as the purchase. Keep credentials in the deployment secret store or an
operator shell; never put them in the command arguments, support ticket, or
committed env file. Save the redacted preview and result in the support record.
Check the Stripe refund status, local `billing_adjustments` row, purchase
`revoked_at`, and the workspace's effective access before closing the request.

The current unit tests exercise these database and provider-call paths, but a
Stripe test-mode purchase and refund must demonstrate the real Checkout return,
signed webhook delivery, cancellation, ledger entry, and access removal before
any offer is enabled in production.

## What the acceptance suite proves, and what it stopped proving

Stripe gates agent-driven checkout. Its hosted page renders two attestations,
the second revealed by ticking the first, plus instructions telling the agent to
complete the purchase through Link CLI so the buyer's real payment credentials
are never exposed to it. With both ticked and every field valid, Stripe never
issues `/v1/payment_pages/{id}/confirm`. Typing a test card into that page is no
longer a supported way to finish a purchase, and evading the detection is not
something this suite should do.

`app/tests/acceptance/domains/billing/oobe.spec.ts` therefore stops at the
boundary and checks the session against Stripe's own API: status, mode,
`metadata.workspace_id`, `metadata.purchase_intent_id`, `automatic_tax`, and
`tax_id_collection` for each of the three paid plans. Unit tests assert those
parameters against a mocked SDK; this asserts them against Stripe.

Three things are no longer covered by any automated test:

- Submitting a card on Stripe's hosted page.
- The redirect back to `/onboarding/complete`.
- A genuine payment producing a webhook that grants entitlement.

The webhook handler and the entitlement queries are covered by unit tests, so
the gap is the seam between them and a real Stripe payment. Close it before
relying on the suite as a release gate for billing: either rebuild the payment
leg against Stripe's API rather than its hosted page, or ask Stripe to permit
automated testing on the test-mode account.

## Discount review access

Discount requests are submitted from
`https://atlas.rebuildingus.org/request-discount` and reviewed in the hosted app
at:

```text
https://atlas.rebuildingus.org/admin/discounts
```

Hosted review access has two requirements:

1. The reviewer must be signed in to Atlas.
2. The reviewer email must appear in `ATLAS_OPERATOR_ALLOWED_EMAILS` in the
   hosted API environment.

Set `ATLAS_OPERATOR_ALLOWED_EMAILS` as a comma-separated list in
`.env.production`, Vercel Production, and the Cloud Run API environment through
bootstrap. Example:

```env
ATLAS_OPERATOR_ALLOWED_EMAILS=reviewer@rebuildingus.org,billing@rebuildingus.org
```

The API allows local development review with the synthetic local operator, but
hosted staging and production require a real signed-in reviewer email. This
protects applicant evidence and reviewer decisions while keeping the public
discount request form open.

## Failure modes

If bootstrap says an existing coupon does not match the Atlas discount catalog,
use the canonical coupons from `scripts/bootstrap/config/products.ts` or let
bootstrap create them in the target mode. The canonical coupons are
product-scoped to Atlas Pro.

If production billing fails with `Invalid API Key`, confirm the key starts with
`rk_live_` or is a live secret key created in the Stripe Dashboard with the
permissions listed above.
