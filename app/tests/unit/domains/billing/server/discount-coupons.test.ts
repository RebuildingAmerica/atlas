import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STRIPE_ATLAS_CATALOG_ENV_KEY,
  createStripeAtlasCatalogFixture,
} from "../../../../fixtures/billing/stripe-price-envs";

import {
  getDiscountCouponId,
  getDiscountCouponIdForCheckout,
} from "@/domains/billing/server/discount-coupons";

vi.mock("@tanstack/react-start/server-only", () => ({}));

describe("discount coupons", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("applies the student coupon only to the four-month Atlas Pro checkout", () => {
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, createStripeAtlasCatalogFixture());

    expect(getDiscountCouponIdForCheckout("student", "atlas_pro", "four_month")).toBe(
      "coupon_student",
    );
    expect(getDiscountCouponIdForCheckout("student", "atlas_pro", "monthly")).toBeNull();
    expect(getDiscountCouponIdForCheckout("student", "atlas_team", "four_month")).toBeNull();
  });

  it("applies the journalist coupon to individual Pro checkout and never to Team", () => {
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, createStripeAtlasCatalogFixture());

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
  it.each([
    ["student", "coupon_student"],
    ["independent_journalist", "coupon_journalist"],
    ["grassroots_nonprofit", "coupon_nonprofit"],
    ["civic_tech_worker", "coupon_civic_tech"],
  ] as const)("maps the %s segment onto its configured coupon", (segment, couponId) => {
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, createStripeAtlasCatalogFixture());

    expect(getDiscountCouponId(segment)).toBe(couponId);
  });

  it("refuses to resolve a coupon when the catalog is not configured", () => {
    expect(() => getDiscountCouponId("student")).toThrow(/STRIPE_ATLAS_CATALOG/);
  });
});
