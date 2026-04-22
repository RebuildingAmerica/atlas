import "@tanstack/react-start/server-only";

import type { DiscountSegment } from "../discount-segments";

/**
 * Maps discount segments to Stripe coupon IDs.
 *
 * TODO: These coupon IDs should be created in Stripe and stored in environment
 * variables. For now, they are placeholders.
 */
const DISCOUNT_COUPONS: Record<DiscountSegment, string> = {
  independent_journalist: process.env.STRIPE_COUPON_JOURNALIST || "",
  grassroots_nonprofit: process.env.STRIPE_COUPON_NONPROFIT || "",
  civic_tech_worker: process.env.STRIPE_COUPON_CIVIC_TECH || "",
} as const;

/**
 * Resolves the Stripe coupon ID for a verified discount segment.
 *
 * Returns null if no coupon is configured for the segment.
 */
export function getDiscountCouponId(segment: DiscountSegment): string | null {
  return DISCOUNT_COUPONS[segment]?.trim() || null;
}
