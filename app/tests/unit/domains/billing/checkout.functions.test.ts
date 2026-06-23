import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";
import { createAtlasSessionFixture } from "../../../fixtures/access/sessions";
import { STRIPE_PRICE_ENVS } from "../../../fixtures/billing/stripe-price-envs";

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
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
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
  getDiscountCouponId: mocks.getDiscountCouponId,
}));

vi.mock("@/domains/billing/server/stripe-customer", () => ({
  ensureStripeCustomerForWorkspace: mocks.ensureStripeCustomerForWorkspace,
}));

describe("checkout.functions", () => {
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
      priceId: "price_pro_yearly",
      product: "atlas_pro",
      seatPriceId: null,
      seatQuantity: 0,
      stripeCustomerId: "cus_123",
      successUrl: "https://atlas.test/checkout-complete?product=atlas_pro",
      workspaceId: "org_team",
    });
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
    interface CheckoutCall {
      priceId: string;
    }
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as CheckoutCall | undefined;
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
    interface CheckoutCall {
      priceId: string;
    }
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as CheckoutCall | undefined;
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
    interface CheckoutCall {
      priceId: string;
    }
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as CheckoutCall | undefined;
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
    interface CheckoutCall {
      priceId: string;
    }
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as CheckoutCall | undefined;
    expect(call?.priceId).toBe("price_pass_weekly");
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
    interface CheckoutCall {
      priceId: string;
    }
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as CheckoutCall | undefined;
    expect(call?.priceId).toBe("price_pass_once");
  });

  it("rejects checkout when Stripe price is not configured", async () => {
    vi.stubEnv("STRIPE_PRICE_ATLAS_PRO_YEARLY", "");
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_pro", interval: "yearly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("Stripe price not configured");
  });

  it("rejects checkout without an active workspace", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(
      createAtlasSessionFixture({
        workspace: {
          activeOrganization: null,
          activeProducts: [],
          capabilities: {
            canInviteMembers: false,
            canManageOrganization: false,
            canSwitchOrganizations: false,
            canUseTeamFeatures: false,
          },
          memberships: [],
          onboarding: { hasPendingInvitations: false, needsWorkspace: true },
          pendingInvitations: [],
          resolvedCapabilities: {
            capabilities: [],
            limits: {
              api_requests_per_day: 0,
              max_api_keys: 0,
              max_members: 1,
              max_shortlist_entries: 25,
              max_shortlists: 1,
              public_api_requests_per_hour: 100,
              research_runs_per_month: 0,
            },
          },
        },
      }),
    );

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_pro", interval: "yearly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("Choose or create a workspace");
  });

  it("creates a Stripe customer on demand when the workspace lacks one", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { workspaceType: "team" },
    });
    mocks.ensureStripeCustomerForWorkspace.mockResolvedValue("cus_new");
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/new" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_pro", interval: "yearly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(mocks.ensureStripeCustomerForWorkspace).toHaveBeenCalledWith(
      "org_team",
      "operator@atlas.test",
      "Atlas Team",
    );
    interface CheckoutCall {
      stripeCustomerId: string | null;
    }
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as CheckoutCall | undefined;
    expect(call?.stripeCustomerId).toBe("cus_new");
  });

  it("falls back to customer-email checkout when Stripe customer pre-creation fails", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { workspaceType: "team" },
    });
    mocks.ensureStripeCustomerForWorkspace.mockRejectedValue(new Error("Stripe down"));
    mocks.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/email" });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_pro", interval: "yearly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    interface CheckoutCall {
      stripeCustomerId: string | null;
    }
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as CheckoutCall | undefined;
    expect(call?.stripeCustomerId).toBeNull();
  });

  it("rejects checkout when Stripe does not return a session URL", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { stripeCustomerId: "cus_123", workspaceType: "team" },
    });
    mocks.createCheckoutSession.mockResolvedValue({ url: null });

    const { startCheckout } = await import("@/domains/billing/checkout.functions");
    const response = (await startCheckout.__executeServer({
      method: "POST",
      data: { product: "atlas_pro", interval: "yearly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("did not return a checkout URL");
  });

  interface SeatCheckoutCall {
    seatPriceId: string | null;
    seatQuantity: number;
  }

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
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as SeatCheckoutCall | undefined;
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
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as SeatCheckoutCall | undefined;
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
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as SeatCheckoutCall | undefined;
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
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as SeatCheckoutCall | undefined;
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
