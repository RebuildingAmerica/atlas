import "@tanstack/react-start/server-only";

import type { AtlasSelfServeProduct } from "@/domains/access/capabilities";
import type { PricingCheckoutInterval } from "../checkout-types";
import type { DiscountSegment } from "../discount-segments";

interface DiscountCouponRule {
  envKey: string;
  intervals: readonly PricingCheckoutInterval[];
  products: readonly AtlasSelfServeProduct[];
}

const DISCOUNT_COUPON_RULES: Record<DiscountSegment, DiscountCouponRule> = {
  student: {
    envKey: "STRIPE_COUPON_STUDENT",
    intervals: ["four_month"],
    products: ["atlas_pro"],
  },
  independent_journalist: {
    envKey: "STRIPE_COUPON_JOURNALIST",
    intervals: ["monthly", "yearly"],
    products: ["atlas_pro"],
  },
  grassroots_nonprofit: {
    envKey: "STRIPE_COUPON_NONPROFIT",
    intervals: ["monthly", "yearly"],
    products: ["atlas_pro"],
  },
  civic_tech_worker: {
    envKey: "STRIPE_COUPON_CIVIC_TECH",
    intervals: ["monthly", "yearly"],
    products: ["atlas_pro"],
  },
};

/**
 * Resolves the Stripe coupon ID for a verified discount segment.
 *
 * Returns null if no coupon is configured for the segment.
 */
export function getDiscountCouponId(segment: DiscountSegment): string | null {
  return process.env[DISCOUNT_COUPON_RULES[segment].envKey]?.trim() || null;
}

/**
 * Resolves the coupon Atlas is allowed to attach to a specific Checkout flow.
 */
export function getDiscountCouponIdForCheckout(
  segment: DiscountSegment,
  product: AtlasSelfServeProduct,
  interval: PricingCheckoutInterval,
): string | null {
  const rule = DISCOUNT_COUPON_RULES[segment];
  if (!rule.products.includes(product) || !rule.intervals.includes(interval)) {
    return null;
  }
  return process.env[rule.envKey]?.trim() || null;
}
