import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));

describe("production billing offers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows catalog offers in local test mode", async () => {
    vi.stubEnv("VERCEL_ENV", "development");
    const { getAllowedBillingOffers } = await import("@/domains/billing/server/billing-offers");
    expect(getAllowedBillingOffers()).toContain("atlas_pro:monthly");
    expect(getAllowedBillingOffers()).toContain("atlas_research_pass:weekly");
  });

  it("closes all production offers without an explicit allowlist", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ATLAS_BILLING_ALLOWED_OFFERS", "");
    const { getAllowedBillingOffers } = await import("@/domains/billing/server/billing-offers");
    expect(getAllowedBillingOffers()).toEqual([]);
  });

  it("opens only exact reviewed offers in production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ATLAS_BILLING_ALLOWED_OFFERS", "atlas_pro:monthly,atlas_research_pass:weekly");
    const { getAllowedBillingOffers, isBillingOfferAllowed } =
      await import("@/domains/billing/server/billing-offers");
    expect(getAllowedBillingOffers()).toEqual(["atlas_pro:monthly", "atlas_research_pass:weekly"]);
    expect(isBillingOfferAllowed("atlas_pro", "monthly")).toBe(true);
    expect(isBillingOfferAllowed("atlas_pro", "yearly")).toBe(false);
    expect(isBillingOfferAllowed("atlas_team", "monthly")).toBe(false);
  });

  it("fails closed for an unknown or malformed offer", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ATLAS_BILLING_ALLOWED_OFFERS", "atlas_pro:monthly,not_a_product:monthly");
    const { getAllowedBillingOffers } = await import("@/domains/billing/server/billing-offers");
    expect(getAllowedBillingOffers()).toEqual([]);
  });
});
