import "@tanstack/react-start/server-only";

import type { AtlasSelfServeProduct } from "@/domains/access/capabilities";
import type { PricingCheckoutInterval } from "../checkout-types";
import type { DiscountSegment } from "../discount-segments";
import { getAtlasDiscountCouponIds } from "../products";
import type { AtlasDiscountCouponIds } from "../products";

interface DiscountCouponRule {
  couponKey: keyof AtlasDiscountCouponIds;
  intervals: readonly PricingCheckoutInterval[];
  products: readonly AtlasSelfServeProduct[];
}

const DISCOUNT_COUPON_RULES: Record<DiscountSegment, DiscountCouponRule> = {
  student: {
    couponKey: "student",
    intervals: ["four_month"],
    products: ["atlas_pro"],
  },
  independent_journalist: {
    couponKey: "independent_journalist",
    intervals: ["monthly", "yearly"],
    products: ["atlas_pro"],
  },
  grassroots_nonprofit: {
    couponKey: "grassroots_nonprofit",
    intervals: ["monthly", "yearly"],
    products: ["atlas_pro"],
  },
  civic_tech_worker: {
    couponKey: "civic_tech_worker",
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
  const rule = DISCOUNT_COUPON_RULES[segment];
  return getAtlasDiscountCouponIds()[rule.couponKey];
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
  return getAtlasDiscountCouponIds()[rule.couponKey];
}
