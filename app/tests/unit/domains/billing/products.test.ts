import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STRIPE_ATLAS_CATALOG_ENV_KEY,
  createStripeAtlasCatalogFixture,
} from "../../../fixtures/billing/stripe-price-envs";

describe("billing/products env helper", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads trimmed price IDs from the generated Stripe catalog env", async () => {
    vi.stubEnv(
      STRIPE_ATLAS_CATALOG_ENV_KEY,
      createStripeAtlasCatalogFixture({
        prices: {
          "pro-monthly": "  price_pro_month  ",
          "team-base-monthly": "  price_team_base_month  ",
        },
      }),
    );

    const { getAtlasBillingProducts } = await import("@/domains/billing/products");
    const products = getAtlasBillingProducts();
    expect(products.atlas_pro.monthlyPriceId).toBe("price_pro_month");
    expect(products.atlas_team.monthlyPriceId).toBe("price_team_base_month");
    expect(products.atlas_team.yearlyPriceId).toBe("price_team_yearly");
    expect(products.atlas_team.monthlySeatPriceId).toBe("price_team_seat_monthly");
    expect(products.atlas_team.yearlySeatPriceId).toBe("price_team_seat_yearly");
    expect(products.atlas_research_pass.oncePriceId).toBe("price_pass_once");
    expect(products.atlas_research_pass.weeklyPriceId).toBe("price_pass_weekly");
  });

  it("throws when the generated Stripe catalog env is unset", async () => {
    const { getAtlasBillingProducts } = await import("@/domains/billing/products");
    expect(() => getAtlasBillingProducts()).toThrow(/STRIPE_ATLAS_CATALOG/);
  });

  it("throws when a required catalog price ID is empty", async () => {
    vi.stubEnv(
      STRIPE_ATLAS_CATALOG_ENV_KEY,
      createStripeAtlasCatalogFixture({
        prices: { "team-seat-monthly": "" },
      }),
    );

    const { getAtlasBillingProducts } = await import("@/domains/billing/products");
    expect(() => getAtlasBillingProducts()).toThrow(/prices\.team-seat-monthly/);
  });
  it("rejects a catalog that is not valid JSON", async () => {
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, "{not json");

    const { getAtlasBillingProducts } = await import("@/domains/billing/products");
    expect(() => getAtlasBillingProducts()).toThrow("STRIPE_ATLAS_CATALOG must be valid JSON.");
  });

  it("rejects a catalog that parses to something other than an object", async () => {
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, '["price_pro_monthly"]');

    const { getAtlasBillingProducts } = await import("@/domains/billing/products");
    expect(() => getAtlasBillingProducts()).toThrow("STRIPE_ATLAS_CATALOG must be a JSON object.");
  });

  it("rejects a catalog with no prices section", async () => {
    const catalog = JSON.parse(createStripeAtlasCatalogFixture()) as Record<string, unknown>;
    delete catalog.prices;
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, JSON.stringify(catalog));

    const { getAtlasBillingProducts } = await import("@/domains/billing/products");
    expect(() => getAtlasBillingProducts()).toThrow(
      "STRIPE_ATLAS_CATALOG.prices is required for billing operations.",
    );
  });

  it("rejects a catalog whose section is not an object", async () => {
    vi.stubEnv(
      STRIPE_ATLAS_CATALOG_ENV_KEY,
      JSON.stringify({ coupons: {}, prices: {}, products: "prod_pro" }),
    );

    const { getAtlasBillingProducts } = await import("@/domains/billing/products");
    expect(() => getAtlasBillingProducts()).toThrow(
      "STRIPE_ATLAS_CATALOG.products is required for billing operations.",
    );
  });

  it("rejects a catalog whose price ID is not a string", async () => {
    const catalog = JSON.parse(createStripeAtlasCatalogFixture()) as {
      prices: Record<string, unknown>;
    };
    catalog.prices["pro-yearly"] = 4800;
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, JSON.stringify(catalog));

    const { getAtlasBillingProducts } = await import("@/domains/billing/products");
    expect(() => getAtlasBillingProducts()).toThrow(
      "STRIPE_ATLAS_CATALOG.prices.pro-yearly is required for billing operations.",
    );
  });

  it("rejects a catalog whose price ID is only whitespace", async () => {
    vi.stubEnv(
      STRIPE_ATLAS_CATALOG_ENV_KEY,
      createStripeAtlasCatalogFixture({ prices: { "pro-monthly": "   " } }),
    );

    const { getAtlasBillingProducts } = await import("@/domains/billing/products");
    expect(() => getAtlasBillingProducts()).toThrow(
      "STRIPE_ATLAS_CATALOG.prices.pro-monthly is required for billing operations.",
    );
  });

  it("rejects a catalog env that is only whitespace", async () => {
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, "   ");

    const { getAtlasBillingProducts } = await import("@/domains/billing/products");
    expect(() => getAtlasBillingProducts()).toThrow(
      "STRIPE_ATLAS_CATALOG is required for billing operations.",
    );
  });

  it("reads the discount coupon IDs from the catalog", async () => {
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, createStripeAtlasCatalogFixture());

    const { getAtlasDiscountCouponIds } = await import("@/domains/billing/products");
    expect(getAtlasDiscountCouponIds()).toEqual({
      civic_tech_worker: "coupon_civic_tech",
      grassroots_nonprofit: "coupon_nonprofit",
      independent_journalist: "coupon_journalist",
      student: "coupon_student",
    });
  });

  it("reads the product IDs from the catalog", async () => {
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, createStripeAtlasCatalogFixture());

    const { getStripeAtlasCatalog } = await import("@/domains/billing/products");
    expect(getStripeAtlasCatalog().products).toEqual({
      pro: "prod_pro",
      "research-pass": "prod_research_pass",
      "team-base": "prod_team_base",
      "team-seat": "prod_team_seat",
    });
  });
});
