import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFnExecutionResponse } from "../../../../../helpers/server-fn-stub";
import { createAtlasSessionFixture } from "../../../../../fixtures/access/sessions";
import { STRIPE_PRICE_ENVS } from "../../../../../fixtures/billing/stripe-price-envs";
import type { CreateCheckoutOptions } from "@/domains/billing/server/checkout";

const mocks = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  ensureAuthReady: vi.fn(),
  ensureStripeCustomerForWorkspace: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  getDiscountCouponId: vi.fn(),
  requireAtlasSessionState: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));

vi.mock("@/domains/access/server/request-headers", () => ({
  getBrowserSessionHeaders: mocks.getBrowserSessionHeaders,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/session-state", () => ({
  requireAtlasSessionState: mocks.requireAtlasSessionState,
}));

vi.mock("@/domains/billing/server/checkout", () => ({
  createCheckoutSession: mocks.createCheckoutSession,
}));

vi.mock("@/domains/billing/server/discount-coupons", () => ({
  getDiscountCouponIdForCheckout: mocks.getDiscountCouponId,
}));

vi.mock("@/domains/billing/server/stripe-customer", () => ({
  ensureStripeCustomerForWorkspace: mocks.ensureStripeCustomerForWorkspace,
}));

describe("checkout.functions pricing", () => {
  const browserSessionHeaders = new Headers({ cookie: "test" });
  const authApi = {
    getFullOrganization: vi.fn(),
  };

  beforeEach(() => {
    vi.resetModules();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    Object.values(authApi).forEach((mock) => mock.mockReset());

    for (const [key, value] of Object.entries(STRIPE_PRICE_ENVS)) {
      vi.stubEnv(key, value);
    }

    mocks.getAuthRuntimeConfig.mockReturnValue({ publicBaseUrl: "https://atlas.test" });
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
    mocks.ensureAuthReady.mockResolvedValue({ api: authApi });
    mocks.getDiscountCouponId.mockReturnValue("coupon_segment");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a Stripe Checkout session for an Atlas Pro yearly subscription with discount", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: {
        discountSegment: "grassroots_nonprofit",
        stripeCustomerId: "cus_123",
        verificationStatus: "verified",
        workspaceType: "team",
      },
    });
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/abc" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_pro", interval: "yearly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ url: "https://checkout.stripe.test/c/abc" });
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith({
      cancelUrl: "https://atlas.test/pricing",
      customerEmail: "operator@atlas.test",
      discountCouponId: "coupon_segment",
      interval: "yearly",
      priceId: "price_pro_yearly",
      product: "atlas_pro",
      seatPriceId: null,
      seatQuantity: 0,
      stripeCustomerId: "cus_123",
      successUrl: "https://atlas.test/checkout-complete?product=atlas_pro",
      workspaceId: "org_team",
    });
    expect(mocks.getDiscountCouponId).toHaveBeenCalledWith(
      "grassroots_nonprofit",
      "atlas_pro",
      "yearly",
    );
  });

  it("uses student four-month pricing with the student coupon", async () => {
    vi.stubEnv("STRIPE_PRICE_ATLAS_PRO_STUDENT_FOUR_MONTH", "price_pro_student_four_month");
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: {
        discountSegment: "student",
        stripeCustomerId: "cus_123",
        verificationStatus: "verified",
        workspaceType: "individual",
      },
    });
    mocks.getDiscountCouponId.mockReturnValue("coupon_student");
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/stu" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_pro", interval: "four_month" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        discountCouponId: "coupon_student",
        interval: "four_month",
        priceId: "price_pro_student_four_month",
        product: "atlas_pro",
      }),
    );
  });

  it("does not apply individual discount coupons to Team checkout", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: {
        discountSegment: "independent_journalist",
        stripeCustomerId: "cus_123",
        verificationStatus: "verified",
        workspaceType: "team",
      },
    });
    mocks.getDiscountCouponId.mockReturnValue(null);
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/team" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_team", interval: "monthly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(mocks.getDiscountCouponId).toHaveBeenCalledWith(
      "independent_journalist",
      "atlas_team",
      "monthly",
    );
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ discountCouponId: null }),
    );
  });

  it("falls back to monthly Atlas Pro pricing when no other interval matches", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { stripeCustomerId: "cus_123", workspaceType: "team" },
    });
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/m" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_pro", interval: "monthly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
    expect(call?.priceId).toBe("price_pro_monthly");
  });

  it("uses Atlas Team yearly price when interval is yearly", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { stripeCustomerId: "cus_123", workspaceType: "team" },
    });
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/ty" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_team", interval: "yearly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
    expect(call?.priceId).toBe("price_team_yearly");
  });

  it("uses Atlas Team monthly price when interval is monthly", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { stripeCustomerId: "cus_123", workspaceType: "team" },
    });
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/tm" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_team", interval: "monthly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
    expect(call?.priceId).toBe("price_team_monthly");
  });

  it("uses Atlas Research Pass weekly price when interval is weekly", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { stripeCustomerId: "cus_123", workspaceType: "team" },
    });
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/rw" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_research_pass", interval: "weekly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
    expect(call?.priceId).toBe("price_pass_weekly");
    expect(call?.interval).toBe("weekly");
  });

  it("uses Atlas Research Pass once price for non-weekly intervals", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { stripeCustomerId: "cus_123", workspaceType: "team" },
    });
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/ro" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_research_pass", interval: "once" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
    expect(call?.priceId).toBe("price_pass_once");
    expect(call?.interval).toBe("once");
  });

  it("bills additional Team seats by member count for a monthly subscription", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { stripeCustomerId: "cus_123", workspaceType: "team" },
      members: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
    });
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/seats" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_team", interval: "monthly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
    expect(call?.seatPriceId).toBe("price_team_seat_monthly");
    expect(call?.seatQuantity).toBe(2);
  });

  it("uses the yearly seat price for a yearly Team subscription", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { stripeCustomerId: "cus_123", workspaceType: "team" },
      members: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
    });
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/seatsy" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_team", interval: "yearly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
    expect(call?.seatPriceId).toBe("price_team_seat_yearly");
    expect(call?.seatQuantity).toBe(2);
  });

  it("omits Team seats when the workspace has only the owner", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { stripeCustomerId: "cus_123", workspaceType: "team" },
      members: [{ id: "owner" }],
    });
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/base" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_team", interval: "monthly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
    expect(call?.seatPriceId).toBeNull();
    expect(call?.seatQuantity).toBe(0);
  });

  it("does not attach seats to non-Team products", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { stripeCustomerId: "cus_123", workspaceType: "team" },
      members: [{ id: "m1" }, { id: "m2" }],
    });
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/pro" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_pro", interval: "monthly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
    expect(call?.seatPriceId).toBeNull();
    expect(call?.seatQuantity).toBe(0);
  });

  it("rejects checkout when the Team seat price is unconfigured", async () => {
    vi.stubEnv("STRIPE_PRICE_ATLAS_TEAM_SEAT_MONTHLY", "");
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { stripeCustomerId: "cus_123", workspaceType: "team" },
      members: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
    });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_team", interval: "monthly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("seat price not configured");
  });
});
