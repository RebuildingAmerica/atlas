import { afterEach, describe, expect, it, vi } from "vitest";

import { getDiscountCouponIdForCheckout } from "@/domains/billing/server/discount-coupons";

vi.mock("@tanstack/react-start/server-only", () => ({}));

describe("discount coupons", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("applies the student coupon only to the four-month Atlas Pro checkout", () => {
    vi.stubEnv("STRIPE_COUPON_STUDENT", "coupon_student");

    expect(getDiscountCouponIdForCheckout("student", "atlas_pro", "four_month")).toBe(
      "coupon_student",
    );
    expect(getDiscountCouponIdForCheckout("student", "atlas_pro", "monthly")).toBeNull();
    expect(getDiscountCouponIdForCheckout("student", "atlas_team", "four_month")).toBeNull();
  });

  it("applies the journalist coupon to individual Pro checkout and never to Team", () => {
    vi.stubEnv("STRIPE_COUPON_JOURNALIST", "coupon_journalist");

    expect(getDiscountCouponIdForCheckout("independent_journalist", "atlas_pro", "monthly")).toBe(
      "coupon_journalist",
    );
    expect(getDiscountCouponIdForCheckout("independent_journalist", "atlas_pro", "yearly")).toBe(
      "coupon_journalist",
    );
    expect(
      getDiscountCouponIdForCheckout("independent_journalist", "atlas_team", "monthly"),
    ).toBeNull();
  });
});
