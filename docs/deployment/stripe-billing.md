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

That policy matters operationally: do not create hidden Team discounts or
alternate Team products. Discount coupons are scoped to Atlas Pro only.

## Catalog

The canonical catalog lives in `scripts/bootstrap/config/products.ts`.

| Stripe object                 | Canonical value                                    |
| ----------------------------- | -------------------------------------------------- |
| Atlas Pro                     | Product `pro`                                      |
| Pro monthly price             | $5 every month                                     |
| Pro annual price              | $48 every year                                     |
| Pro student price             | $16 every 4 months before coupon                   |
| Student coupon                | 20% off Pro, yielding $12.80 every 4 months        |
| Creator and journalist coupon | 50% off Pro monthly or annual                      |
| Grassroots nonprofit coupon   | 40% off Pro monthly or annual                      |
| Civic tech coupon             | 50% off Pro monthly or annual                      |
| Atlas Team Base               | $25 every month or $250 every year                 |
| Atlas Team Seat               | $8 per seat every month or $80 per seat every year |
| Atlas Research Pass           | $9 for 30 days or $4 for 7 days                    |

The student price intentionally pairs a four-month recurring price with a
student-only coupon. The net charge is $12.80 every four months, or $38.40 per
year, which is 80% of annual Pro paid in three installments.

Research Pass matches Team-level individual quota and access for its duration:
unlimited research, unlimited shortlists and notes, export, MCP/OAuth,
watchlists, unlimited API keys, and 10,000 requests per day per key. It does not
grant shared seats, SSO, or SCIM.

## Environment keys

Every local, staging, and production runtime needs the same key names. Values
are mode-specific; never copy test IDs into live mode or live IDs into test
mode.

```env
STRIPE_API_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRODUCT_ATLAS_PRO=
STRIPE_PRICE_ATLAS_PRO_MONTHLY=
STRIPE_PRICE_ATLAS_PRO_YEARLY=
STRIPE_PRICE_ATLAS_PRO_STUDENT_FOUR_MONTH=
STRIPE_PRODUCT_ATLAS_TEAM_BASE=
STRIPE_PRICE_ATLAS_TEAM_BASE_MONTHLY=
STRIPE_PRICE_ATLAS_TEAM_BASE_YEARLY=
STRIPE_PRODUCT_ATLAS_TEAM_SEAT=
STRIPE_PRICE_ATLAS_TEAM_SEAT_MONTHLY=
STRIPE_PRICE_ATLAS_TEAM_SEAT_YEARLY=
STRIPE_PRODUCT_ATLAS_RESEARCH_PASS=
STRIPE_PRICE_ATLAS_RESEARCH_PASS_ONCE=
STRIPE_PRICE_ATLAS_RESEARCH_PASS_WEEKLY=
STRIPE_COUPON_STUDENT=
STRIPE_COUPON_JOURNALIST=
STRIPE_COUPON_NONPROFIT=
STRIPE_COUPON_CIVIC_TECH=
```

## Preconditions

Before running the billing bootstrap:

1. Install dependencies with `pnpm install`.
2. Install and authenticate the Stripe CLI with `stripe login`.
3. Link the Vercel project for hosted staging and production env sync.
4. Set `ATLAS_PUBLIC_URL` for the target environment.
5. For production, use a live `sk_live_...` secret key or a Dashboard-created
   live restricted key with product, price, coupon, customer, Checkout/Billing,
   and webhook permissions.

Stripe CLI OAuth keys can work for test-mode local and staging operations.
Production bootstrap does not fall back to Stripe CLI auth or the root `.env`
file. Set `STRIPE_API_KEY` explicitly with a Dashboard-created live key because
the bootstrap uses the Stripe SDK and the hosted app needs the same live runtime
key to create Checkout sessions.

## Local development

Run local product sync in Stripe test mode:

```bash
pnpm bootstrap:stripe:local
```

This writes Stripe values to `.env` and `app/.env.local`.

Keep webhook delivery open while testing Checkout locally:

```bash
pnpm stripe:listen
```

The script forwards these events to
`https://atlas.localhost/api/stripe/webhook`:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Staging

Staging uses Stripe test-mode objects and Vercel Preview environment variables:

```bash
pnpm bootstrap:stripe:staging
```

The command writes `.env.staging`, creates or verifies the Stripe test-mode
catalog, creates or verifies the staging webhook endpoint, and syncs non-empty
`STRIPE_*` values into the linked Vercel Preview environment.

For noninteractive shells, append `-- --yes`:

```bash
pnpm bootstrap:stripe:staging -- --yes
```

## Production

Production uses Stripe live-mode objects and Vercel Production environment
variables:

```bash
STRIPE_API_KEY=sk_live_replace_me pnpm bootstrap:stripe:prod
```

The command writes `.env.production`, creates or verifies the Stripe live-mode
catalog, creates or verifies the production webhook endpoint, and syncs
non-empty `STRIPE_*` values into the linked Vercel Production environment.

Do not run production bootstrap with a test key. The script rejects mismatched
test/live keys before mutating Stripe.

For noninteractive shells, append `-- --yes` while still passing the live key:

```bash
STRIPE_API_KEY=sk_live_replace_me pnpm bootstrap:stripe:prod -- --yes
```

## Verification

After each bootstrap run, verify the app-facing contract:

```bash
pnpm bootstrap:test
cd app && pnpm vitest run tests/unit/domains/billing/checkout.functions.test.ts tests/unit/domains/billing/server/discount-coupons.test.ts
```

Then verify the target Stripe catalog from the env file Atlas will actually
load:

```bash
pnpm bootstrap:stripe:verify:local
pnpm bootstrap:stripe:verify:staging
STRIPE_API_KEY=sk_live_replace_me pnpm bootstrap:stripe:verify:prod
```

Run only the target you just bootstrapped. The verifier checks required env
keys, product IDs, price amounts and intervals, product-scoped coupons, and
inactive or missing Stripe objects without printing secrets.

For hosted targets, verify Vercel received the billing keys:

```bash
vercel env ls --scope rebuilding-america-project --cwd app
```

The expected state is:

- `STRIPE_PRICE_ATLAS_PRO_STUDENT_FOUR_MONTH` is present.
- `STRIPE_COUPON_STUDENT` is present.
- Every discount coupon applies only to the Atlas Pro Stripe product.
- Team checkout never attaches student, creator/journalist, nonprofit, or civic
  tech coupons.
- Research Pass checkout stays a one-time payment and never grants SSO or SCIM.

## Failure modes

If bootstrap says an existing coupon does not match the Atlas discount catalog,
do not point Atlas at that old coupon. The canonical coupons are product-scoped
to Atlas Pro. Create the current coupon ID from
`scripts/bootstrap/config/products.ts` or let bootstrap create it in the target
mode.

If production bootstrap fails with `Invalid API Key`, confirm the key starts
with `sk_live_` or is a live restricted key created in the Stripe Dashboard with
the permissions listed above.
