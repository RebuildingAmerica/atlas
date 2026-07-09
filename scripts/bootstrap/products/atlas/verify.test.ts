import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ATLAS_COUPONS, ATLAS_PRODUCTS } from "../../config/products.js";
import {
  STRIPE_ATLAS_CATALOG_ENV_KEY,
  buildStripeEnvUpdates,
  expandStripeCatalogEnv,
} from "./env.js";
import type {
  StripeCatalogSnapshot,
  StripeCouponSnapshot,
  StripePriceSnapshot,
  StripeProductSnapshot,
} from "./verify.js";
import {
  formatStripeVerificationFollowUp,
  verifyStripeCatalogSnapshot,
} from "./verify.js";
import { stripeLiveRestrictedKeySetupSteps } from "./bootstrap.js";

function completeEnv(): Map<string, string> {
  const stripeIds = new Map<string, string>();
  for (const product of ATLAS_PRODUCTS) {
    stripeIds.set(product.envProductKey, `stripe_${product.envProductKey}`);
    for (const price of product.prices) {
      stripeIds.set(price.envKey, `stripe_${price.envKey}`);
    }
  }
  for (const coupon of ATLAS_COUPONS) {
    stripeIds.set(coupon.envKey, coupon.id);
  }
  return buildStripeEnvUpdates("sk_test_123", "whsec_123", stripeIds);
}

function productSnapshots(
  env: Map<string, string>,
): Map<string, StripeProductSnapshot> {
  return new Map(
    ATLAS_PRODUCTS.map((product) => [
      product.envProductKey,
      {
        active: true,
        envKey: product.envProductKey,
        id: env.get(product.envProductKey) ?? "",
        metadata: { atlas_product_id: product.id },
        name: product.stripeName,
      },
    ]),
  );
}

function priceSnapshots(
  env: Map<string, string>,
): Map<string, StripePriceSnapshot> {
  const prices = new Map<string, StripePriceSnapshot>();
  for (const product of ATLAS_PRODUCTS) {
    for (const price of product.prices) {
      prices.set(price.envKey, {
        active: true,
        currency: price.currency,
        envKey: price.envKey,
        id: env.get(price.envKey) ?? "",
        metadata: { atlas_price_id: price.id },
        productId: env.get(product.envProductKey) ?? "",
        recurringInterval: price.recurring?.interval ?? null,
        recurringIntervalCount: price.recurring
          ? (price.recurring.intervalCount ?? 1)
          : null,
        unitAmount: price.unitAmountCents,
      });
    }
  }
  return prices;
}

function couponSnapshots(
  env: Map<string, string>,
): Map<string, StripeCouponSnapshot> {
  const proProductId = env.get("STRIPE_PRODUCT_ATLAS_PRO") ?? "";
  return new Map(
    ATLAS_COUPONS.map((coupon) => [
      coupon.envKey,
      {
        appliesToProductIds: [proProductId],
        duration: "forever",
        envKey: coupon.envKey,
        id: env.get(coupon.envKey) ?? "",
        metadata: { atlas_discount_segment: coupon.segment },
        percentOff: coupon.percentOff,
      },
    ]),
  );
}

function matchingSnapshot(env: Map<string, string>): StripeCatalogSnapshot {
  return {
    coupons: couponSnapshots(env),
    prices: priceSnapshots(env),
    products: productSnapshots(env),
  };
}

void describe("Stripe catalog verifier", () => {
  void it("accepts a complete catalog snapshot", () => {
    const env = completeEnv();
    const expandedEnv = expandStripeCatalogEnv(env);

    assert.deepEqual(
      verifyStripeCatalogSnapshot(env, matchingSnapshot(expandedEnv)),
      [],
    );
  });

  void it("flags a missing generated catalog env", () => {
    const env = completeEnv();
    env.delete(STRIPE_ATLAS_CATALOG_ENV_KEY);
    const expandedEnv = expandStripeCatalogEnv(completeEnv());

    assert.deepEqual(
      verifyStripeCatalogSnapshot(env, matchingSnapshot(expandedEnv)).map(
        (issue) => issue.code,
      ),
      ["missing_env"],
    );
  });

  void it("flags price drift", () => {
    const env = completeEnv();
    const expandedEnv = expandStripeCatalogEnv(env);
    const snapshot = matchingSnapshot(expandedEnv);
    const proMonthly = snapshot.prices.get("STRIPE_PRICE_ATLAS_PRO_MONTHLY");
    assert.ok(proMonthly);
    snapshot.prices.set("STRIPE_PRICE_ATLAS_PRO_MONTHLY", {
      ...proMonthly,
      recurringInterval: null,
      recurringIntervalCount: null,
    });

    assert.deepEqual(
      verifyStripeCatalogSnapshot(env, snapshot).map((issue) => issue.code),
      ["price_recurring_mismatch"],
    );
  });

  void it("flags discount coupons that apply outside Atlas Pro", () => {
    const env = completeEnv();
    const expandedEnv = expandStripeCatalogEnv(env);
    const snapshot = matchingSnapshot(expandedEnv);
    const journalistCoupon = snapshot.coupons.get("STRIPE_COUPON_JOURNALIST");
    assert.ok(journalistCoupon);
    snapshot.coupons.set("STRIPE_COUPON_JOURNALIST", {
      ...journalistCoupon,
      appliesToProductIds: [
        expandedEnv.get("STRIPE_PRODUCT_ATLAS_TEAM_BASE") ?? "",
      ],
    });

    assert.deepEqual(
      verifyStripeCatalogSnapshot(env, snapshot).map((issue) => issue.code),
      ["coupon_product_scope_mismatch"],
    );
  });

  void it("explains how to finish missing production Stripe setup", () => {
    const followUp = formatStripeVerificationFollowUp("prod", [
      {
        code: "missing_env",
        envKey: "STRIPE_API_KEY",
        message: "STRIPE_API_KEY is missing.",
      },
      {
        code: "missing_env",
        envKey: STRIPE_ATLAS_CATALOG_ENV_KEY,
        message: `${STRIPE_ATLAS_CATALOG_ENV_KEY} is missing.`,
      },
    ]);

    assert.deepEqual(followUp, [
      "Production Stripe setup is incomplete.",
      "Run the guided bootstrap flow: pnpm bootstrap",
      ...stripeLiveRestrictedKeySetupSteps(),
      "Verify again: pnpm stripe:verify:prod",
    ]);
  });
});
