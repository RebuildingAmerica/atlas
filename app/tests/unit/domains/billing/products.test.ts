import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("billing/products env helper", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns the trimmed environment value when the variable is set", async () => {
    vi.stubEnv("STRIPE_PRICE_ATLAS_PRO_MONTHLY", "  price_pro_month  ");
    vi.stubEnv("STRIPE_PRICE_ATLAS_PRO_YEARLY", "price_pro_year");
    vi.stubEnv("STRIPE_PRICE_ATLAS_TEAM_BASE_MONTHLY", "  price_team_base_month  ");
    vi.stubEnv("STRIPE_PRICE_ATLAS_TEAM_BASE_YEARLY", "price_team_base_year");
    vi.stubEnv("STRIPE_PRICE_ATLAS_TEAM_SEAT_MONTHLY", "price_team_seat_month");
    vi.stubEnv("STRIPE_PRICE_ATLAS_TEAM_SEAT_YEARLY", "price_team_seat_year");
    vi.stubEnv("STRIPE_PRICE_ATLAS_RESEARCH_PASS_ONCE", "price_research_once");
    vi.stubEnv("STRIPE_PRICE_ATLAS_RESEARCH_PASS_WEEKLY", "price_research_weekly");
    const { ATLAS_PRODUCTS } = await import("@/domains/billing/products");
    expect(ATLAS_PRODUCTS.atlas_pro.monthlyPriceId).toBe("price_pro_month");
    expect(ATLAS_PRODUCTS.atlas_team.monthlyPriceId).toBe("price_team_base_month");
    expect(ATLAS_PRODUCTS.atlas_team.yearlyPriceId).toBe("price_team_base_year");
    expect(ATLAS_PRODUCTS.atlas_team.monthlySeatPriceId).toBe("price_team_seat_month");
    expect(ATLAS_PRODUCTS.atlas_team.yearlySeatPriceId).toBe("price_team_seat_year");
    expect(ATLAS_PRODUCTS.atlas_research_pass.oncePriceId).toBe("price_research_once");
    expect(ATLAS_PRODUCTS.atlas_research_pass.weeklyPriceId).toBe("price_research_weekly");
  });

  it("falls back to an empty string when the environment variable is unset", async () => {
    // Leave every Stripe env var unset; the helper's `?? ""` fallback runs.
    const { ATLAS_PRODUCTS } = await import("@/domains/billing/products");
    expect(ATLAS_PRODUCTS.atlas_pro.monthlyPriceId).toBe("");
    expect(ATLAS_PRODUCTS.atlas_research_pass.oncePriceId).toBe("");
  });

  it("exposes Atlas Team seat price IDs from the seat environment variables", async () => {
    vi.stubEnv("STRIPE_PRICE_ATLAS_TEAM_SEAT_MONTHLY", "price_team_seat_month");
    vi.stubEnv("STRIPE_PRICE_ATLAS_TEAM_SEAT_YEARLY", "price_team_seat_year");
    const { ATLAS_PRODUCTS } = await import("@/domains/billing/products");
    expect(ATLAS_PRODUCTS.atlas_team.monthlySeatPriceId).toBe("price_team_seat_month");
    expect(ATLAS_PRODUCTS.atlas_team.yearlySeatPriceId).toBe("price_team_seat_year");
  });
});
