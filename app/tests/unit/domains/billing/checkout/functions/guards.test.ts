import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFnExecutionResponse } from "../../../../../helpers/server-fn-stub";
import { createAtlasSessionFixture } from "../../../../../fixtures/access/sessions";
import {
  STRIPE_ATLAS_CATALOG_ENV_KEY,
  createStripeAtlasCatalogFixture,
} from "../../../../../fixtures/billing/stripe-price-envs";
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

describe("checkout.functions guards", () => {
  const browserSessionHeaders = new Headers({ cookie: "test" });
  const authApi = {
    getFullOrganization: vi.fn(),
  };

  beforeEach(() => {
    vi.resetModules();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    Object.values(authApi).forEach((mock) => mock.mockReset());

    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, createStripeAtlasCatalogFixture());

    mocks.getAuthRuntimeConfig.mockReturnValue({ publicBaseUrl: "https://atlas.test" });
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
    mocks.ensureAuthReady.mockResolvedValue({ api: authApi });
    mocks.getDiscountCouponId.mockReturnValue("coupon_segment");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
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
    const call = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
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
});
