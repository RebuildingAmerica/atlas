import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  ATLAS_PRODUCTS,
  ATLAS_COUPONS,
  STRIPE_BILLING_WEBHOOK_EVENTS,
} from "../bootstrap/config/products.js";
import { buildStripeEnvUpdates } from "../bootstrap/products/atlas/env.js";
import type { StripeCatalogSnapshot } from "../bootstrap/products/atlas/verify-types.js";
import { verifyPublicationBilling } from "./publication-billing.js";

function fixture() {
  const ids = new Map<string, string>();
  for (const product of ATLAS_PRODUCTS) {
    ids.set(product.envProductKey, `prod_fixture_${product.id}`);
    for (const price of product.prices)
      ids.set(price.envKey, `price_fixture_${price.id}`);
  }
  for (const coupon of ATLAS_COUPONS) ids.set(coupon.envKey, coupon.id);
  const runtime = Object.fromEntries(
    buildStripeEnvUpdates(
      "sk_live_fixture_only",
      "whsec_fixture_only",
      ids,
      "bpc_fixture",
    ),
  );
  runtime.ATLAS_PUBLIC_URL = "https://atlas.example.org";
  runtime.ATLAS_BILLING_ALLOWED_OFFERS = "atlas_pro:monthly";
  const snapshot: StripeCatalogSnapshot = {
    products: new Map(
      ATLAS_PRODUCTS.map((product) => [
        product.envProductKey,
        {
          id: ids.get(product.envProductKey)!,
          envKey: product.envProductKey,
          active: true,
          name: product.stripeName,
          metadata: { atlas_product_id: product.id },
        },
      ]),
    ),
    prices: new Map(
      ATLAS_PRODUCTS.flatMap((product) =>
        product.prices.map(
          (price) =>
            [
              price.envKey,
              {
                id: ids.get(price.envKey)!,
                envKey: price.envKey,
                active: true,
                productId: ids.get(product.envProductKey)!,
                currency: price.currency,
                unitAmount: price.unitAmountCents,
                metadata: { atlas_price_id: price.id },
                recurringInterval: price.recurring?.interval ?? null,
                recurringIntervalCount: price.recurring
                  ? (price.recurring.intervalCount ?? 1)
                  : null,
              },
            ] as const,
        ),
      ),
    ),
    coupons: new Map(
      ATLAS_COUPONS.map((coupon) => [
        coupon.envKey,
        {
          id: coupon.id,
          envKey: coupon.envKey,
          duration: "forever",
          percentOff: coupon.percentOff,
          appliesToProductIds: [ids.get("STRIPE_PRODUCT_ATLAS_PRO")!],
          metadata: { atlas_discount_segment: coupon.segment },
        },
      ]),
    ),
    webhookEndpoints: new Map([
      [
        "https://atlas.example.org/api/stripe/webhook",
        {
          id: "we_fixture",
          url: "https://atlas.example.org/api/stripe/webhook",
          status: "enabled",
          enabledEvents: [...STRIPE_BILLING_WEBHOOK_EVENTS],
          metadata: { atlas_webhook: "billing" },
        },
      ],
    ]),
  };
  const portal = {
    id: "bpc_fixture",
    active: true,
    livemode: true,
    metadata: { atlas_portal: "billing" },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: { enabled: false },
    },
  };
  const calls: string[] = [];
  const stripe = {
    billingPortal: {
      configurations: {
        retrieve: async (id: string) => {
          calls.push(id);
          return portal;
        },
      },
    },
  } as unknown as Stripe;
  return { runtime, snapshot, portal, stripe, calls };
}

void test("publication verifies the retained live catalog, webhook and exact customer portal read-only", async () => {
  const f = fixture();
  await verifyPublicationBilling(
    f.runtime,
    f.stripe,
    async (_stripe, _env, webhook) => {
      assert.equal(webhook, "https://atlas.example.org/api/stripe/webhook");
      return f.snapshot;
    },
  );
  assert.deepEqual(f.calls, ["bpc_fixture"]);
  f.portal.features.subscription_update.enabled = true;
  await assert.rejects(
    verifyPublicationBilling(f.runtime, f.stripe, async () => f.snapshot),
    /portal/,
  );
});

void test("missing billing settings, test keys and wrong webhooks fail before a portal request", async () => {
  const f = fixture();
  await assert.rejects(
    verifyPublicationBilling(
      { ...f.runtime, STRIPE_WEBHOOK_SECRET: "" },
      f.stripe,
    ),
    /STRIPE_WEBHOOK_SECRET/,
  );
  await assert.rejects(
    verifyPublicationBilling(
      { ...f.runtime, STRIPE_API_KEY: "sk_test_fixture_only" },
      f.stripe,
    ),
  );
  f.snapshot.webhookEndpoints.clear();
  await assert.rejects(
    verifyPublicationBilling(f.runtime, f.stripe, async () => f.snapshot),
    /catalog or webhook/,
  );
  assert.deepEqual(f.calls, []);
});
