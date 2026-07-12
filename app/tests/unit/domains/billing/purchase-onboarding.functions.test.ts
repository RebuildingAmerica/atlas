import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";
import { createAtlasSessionFixture } from "../../../fixtures/access/sessions";
import {
  STRIPE_ATLAS_CATALOG_ENV_KEY,
  createStripeAtlasCatalogFixture,
} from "../../../fixtures/billing/stripe-price-envs";
import type { CreateCheckoutOptions } from "@/domains/billing/server/checkout";

const mocks = vi.hoisted(() => ({
  attachWorkspaceToPurchaseIntent: vi.fn(),
  createCheckoutSession: vi.fn(),
  ensureAuthReady: vi.fn(),
  ensurePurchaseIntent: vi.fn(),
  ensureStripeCustomerForWorkspace: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  loadPurchaseIntent: vi.fn(),
  markPurchaseCheckoutCreated: vi.fn(),
  requireAtlasSessionState: vi.fn(),
  requireReadyAtlasSessionState: vi.fn(),
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
  requireReadyAtlasSessionState: mocks.requireReadyAtlasSessionState,
}));

vi.mock("@/domains/billing/server/checkout", () => ({
  createCheckoutSession: mocks.createCheckoutSession,
}));

vi.mock("@/domains/billing/server/purchase-intents", () => ({
  attachWorkspaceToPurchaseIntent: mocks.attachWorkspaceToPurchaseIntent,
  ensurePurchaseIntent: mocks.ensurePurchaseIntent,
  loadPurchaseIntent: mocks.loadPurchaseIntent,
  markPurchaseCheckoutCreated: mocks.markPurchaseCheckoutCreated,
}));

vi.mock("@/domains/billing/server/stripe-customer", () => ({
  ensureStripeCustomerForWorkspace: mocks.ensureStripeCustomerForWorkspace,
}));

describe("purchase onboarding functions", () => {
  const authApi = {
    getFullOrganization: vi.fn(),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, createStripeAtlasCatalogFixture());

    mocks.ensureAuthReady.mockResolvedValue({ api: authApi });
    mocks.getAuthRuntimeConfig.mockReturnValue({ publicBaseUrl: "https://atlas.test" });
    mocks.getBrowserSessionHeaders.mockReturnValue(new Headers({ cookie: "test" }));
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    mocks.requireReadyAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      members: [{ id: "member_owner" }],
      metadata: { workspaceType: "team" },
    });
  });

  it("starts Stripe checkout from a workspace-backed purchase intent", async () => {
    mocks.loadPurchaseIntent.mockResolvedValue({
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "pi_123",
      interval: "monthly",
      product: "atlas_team",
      status: "workspace_ready",
      stripeCheckoutSessionId: null,
      userId: "user_123",
      workspaceId: "org_team",
    });
    mocks.ensureStripeCustomerForWorkspace.mockResolvedValue("cus_123");
    mocks.createCheckoutSession.mockResolvedValue({
      id: "cs_123",
      url: "https://checkout.stripe.test/c/team",
    });
    mocks.markPurchaseCheckoutCreated.mockResolvedValue({
      id: "pi_123",
      status: "checkout_created",
    });

    const { startPurchaseCheckout } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await startPurchaseCheckout.__executeServer({
      method: "POST",
      data: { purchaseId: "pi_123" },
    })) as ServerFnExecutionResponse<{ url: string }>;

    expect(response.error).toBeUndefined();
    expect(response.result?.url).toBe("https://checkout.stripe.test/c/team");
    const checkoutOptions = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
    expect(checkoutOptions).toMatchObject({
      cancelUrl:
        "https://atlas.test/onboarding?purchase=pi_123&product=atlas_team&interval=monthly&step=payment",
      customerEmail: "operator@atlas.test",
      product: "atlas_team",
      purchaseIntentId: "pi_123",
      successUrl: "https://atlas.test/onboarding/complete?purchase=pi_123",
      workspaceId: "org_team",
    });
    expect(mocks.markPurchaseCheckoutCreated).toHaveBeenCalledWith({
      id: "pi_123",
      stripeCheckoutSessionId: "cs_123",
      userId: "user_123",
    });
  });

  it("rejects workspace attachment when the workspace is not in the current session", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue(
      createAtlasSessionFixture({
        workspace: createAtlasSessionFixture().workspace,
      }),
    );

    const { attachPurchaseWorkspace } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await attachPurchaseWorkspace.__executeServer({
      method: "POST",
      data: { purchaseId: "pi_123", workspaceId: "org_other" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.attachWorkspaceToPurchaseIntent).not.toHaveBeenCalled();
  });

  it("rejects workspace attachment after checkout has been created", async () => {
    mocks.loadPurchaseIntent.mockResolvedValue({
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "pi_123",
      interval: "monthly",
      product: "atlas_team",
      status: "checkout_created",
      stripeCheckoutSessionId: "cs_123",
      userId: "user_123",
      workspaceId: "org_team",
    });

    const { attachPurchaseWorkspace } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await attachPurchaseWorkspace.__executeServer({
      method: "POST",
      data: { purchaseId: "pi_123", workspaceId: "org_team" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.attachWorkspaceToPurchaseIntent).not.toHaveBeenCalled();
  });

  it("rejects workspace attachment when the operator cannot manage the workspace", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue(
      createAtlasSessionFixture({ role: "member" }),
    );
    mocks.loadPurchaseIntent.mockResolvedValue({
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "pi_123",
      interval: "monthly",
      product: "atlas_team",
      status: "workspace_ready",
      stripeCheckoutSessionId: null,
      userId: "user_123",
      workspaceId: "org_team",
    });

    const { attachPurchaseWorkspace } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await attachPurchaseWorkspace.__executeServer({
      method: "POST",
      data: { purchaseId: "pi_123", workspaceId: "org_team" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.attachWorkspaceToPurchaseIntent).not.toHaveBeenCalled();
  });

  it("rejects checkout when the purchase intent is already paid", async () => {
    mocks.loadPurchaseIntent.mockResolvedValue({
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "pi_paid",
      interval: "monthly",
      product: "atlas_team",
      status: "paid",
      stripeCheckoutSessionId: "cs_paid",
      userId: "user_123",
      workspaceId: "org_team",
    });

    const { startPurchaseCheckout } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await startPurchaseCheckout.__executeServer({
      method: "POST",
      data: { purchaseId: "pi_paid" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "failed"] as const)(
    "rejects checkout when the purchase intent is %s",
    async (status) => {
      mocks.loadPurchaseIntent.mockResolvedValue({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: `pi_${status}`,
        interval: "monthly",
        product: "atlas_team",
        status,
        stripeCheckoutSessionId: null,
        userId: "user_123",
        workspaceId: "org_team",
      });

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: `pi_${status}` },
      })) as ServerFnExecutionResponse;

      expect(response.error).toBeInstanceOf(Error);
      expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    },
  );

  it("rejects checkout when the purchase intent is expired", async () => {
    mocks.loadPurchaseIntent.mockResolvedValue({
      expiresAt: "2020-01-01T00:00:00.000Z",
      id: "pi_expired",
      interval: "monthly",
      product: "atlas_team",
      status: "workspace_ready",
      stripeCheckoutSessionId: null,
      userId: "user_123",
      workspaceId: "org_team",
    });

    const { startPurchaseCheckout } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await startPurchaseCheckout.__executeServer({
      method: "POST",
      data: { purchaseId: "pi_expired" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects checkout when the intent workspace is not in the current session", async () => {
    mocks.loadPurchaseIntent.mockResolvedValue({
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "pi_other_workspace",
      interval: "monthly",
      product: "atlas_team",
      status: "workspace_ready",
      stripeCheckoutSessionId: null,
      userId: "user_123",
      workspaceId: "org_other",
    });

    const { startPurchaseCheckout } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await startPurchaseCheckout.__executeServer({
      method: "POST",
      data: { purchaseId: "pi_other_workspace" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects checkout when a checkout session already exists", async () => {
    mocks.loadPurchaseIntent.mockResolvedValue({
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "pi_existing_checkout",
      interval: "monthly",
      product: "atlas_team",
      status: "checkout_created",
      stripeCheckoutSessionId: "cs_existing",
      userId: "user_123",
      workspaceId: "org_team",
    });

    const { startPurchaseCheckout } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await startPurchaseCheckout.__executeServer({
      method: "POST",
      data: { purchaseId: "pi_existing_checkout" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.markPurchaseCheckoutCreated).not.toHaveBeenCalled();
  });

  it("rejects checkout when the operator cannot manage the attached workspace", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue(
      createAtlasSessionFixture({ role: "member" }),
    );
    mocks.loadPurchaseIntent.mockResolvedValue({
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "pi_member",
      interval: "monthly",
      product: "atlas_team",
      status: "workspace_ready",
      stripeCheckoutSessionId: null,
      userId: "user_123",
      workspaceId: "org_team",
    });

    const { startPurchaseCheckout } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await startPurchaseCheckout.__executeServer({
      method: "POST",
      data: { purchaseId: "pi_member" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects unavailable billing intervals before creating a purchase intent", async () => {
    const { ensurePurchaseOnboarding } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await ensurePurchaseOnboarding.__executeServer({
      method: "POST",
      data: { product: "atlas_team", interval: "weekly" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.ensurePurchaseIntent).not.toHaveBeenCalled();
  });

  it("preserves Pro purchase state in the Stripe cancel URL", async () => {
    mocks.loadPurchaseIntent.mockResolvedValue({
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "pi_pro",
      interval: "yearly",
      product: "atlas_pro",
      status: "workspace_ready",
      stripeCheckoutSessionId: null,
      userId: "user_123",
      workspaceId: "org_team",
    });
    mocks.ensureStripeCustomerForWorkspace.mockResolvedValue("cus_123");
    mocks.createCheckoutSession.mockResolvedValue({
      id: "cs_pro",
      url: "https://checkout.stripe.test/c/pro",
    });

    const { startPurchaseCheckout } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await startPurchaseCheckout.__executeServer({
      method: "POST",
      data: { purchaseId: "pi_pro" },
    })) as ServerFnExecutionResponse<{ url: string }>;

    expect(response.error).toBeUndefined();
    const checkoutOptions = mocks.createCheckoutSession.mock.calls[0]?.[0] as
      CreateCheckoutOptions | undefined;
    expect(checkoutOptions?.cancelUrl).toBe(
      "https://atlas.test/onboarding?purchase=pi_pro&product=atlas_pro&interval=yearly&step=payment",
    );
  });
});
