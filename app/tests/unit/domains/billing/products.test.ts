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
});
