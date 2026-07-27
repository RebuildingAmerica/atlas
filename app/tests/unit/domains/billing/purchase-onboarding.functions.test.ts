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
  reconcilePaidCheckoutSession: vi.fn(),
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

vi.mock("@/domains/billing/server/webhook-handler", () => ({
  reconcilePaidCheckoutSession: mocks.reconcilePaidCheckoutSession,
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
    mocks.reconcilePaidCheckoutSession.mockResolvedValue(false);
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

  it("reconciles a checkout-created purchase before returning the completion state", async () => {
    mocks.loadPurchaseIntent
      .mockResolvedValueOnce({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "pi_pending",
        interval: "monthly",
        product: "atlas_pro",
        status: "checkout_created",
        stripeCheckoutSessionId: "cs_pending",
        userId: "user_123",
        workspaceId: "org_team",
      })
      .mockResolvedValueOnce({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "pi_pending",
        interval: "monthly",
        product: "atlas_pro",
        status: "paid",
        stripeCheckoutSessionId: "cs_pending",
        userId: "user_123",
        workspaceId: "org_team",
      });
    mocks.reconcilePaidCheckoutSession.mockResolvedValue(true);

    const { loadPurchaseOnboarding } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await loadPurchaseOnboarding.__executeServer({
      method: "POST",
      data: { purchaseId: "pi_pending" },
    })) as ServerFnExecutionResponse<{ status: string }>;

    expect(response.error).toBeUndefined();
    expect(mocks.reconcilePaidCheckoutSession).toHaveBeenCalledWith("cs_pending");
    expect(mocks.loadPurchaseIntent).toHaveBeenCalledTimes(2);
    expect(response.result?.status).toBe("paid");
  });

  it("does not reconcile a purchase that is already paid", async () => {
    mocks.loadPurchaseIntent.mockResolvedValue({
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "pi_paid",
      interval: "monthly",
      product: "atlas_pro",
      status: "paid",
      stripeCheckoutSessionId: "cs_paid",
      userId: "user_123",
      workspaceId: "org_team",
    });

    const { loadPurchaseOnboarding } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await loadPurchaseOnboarding.__executeServer({
      method: "POST",
      data: { purchaseId: "pi_paid" },
    })) as ServerFnExecutionResponse<{ status: string }>;

    expect(response.error).toBeUndefined();
    expect(mocks.reconcilePaidCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.loadPurchaseIntent).toHaveBeenCalledTimes(1);
    expect(response.result?.status).toBe("paid");
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
  describe("ensurePurchaseOnboarding", () => {
    it("creates a purchase intent for the signed-in operator", async () => {
      mocks.ensurePurchaseIntent.mockResolvedValue({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "pi_new",
        interval: "yearly",
        product: "atlas_pro",
        status: "started",
        stripeCheckoutSessionId: null,
        userId: "user_123",
        workspaceId: null,
      });

      const { ensurePurchaseOnboarding } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await ensurePurchaseOnboarding.__executeServer({
        method: "POST",
        data: { product: "atlas_pro", interval: "yearly" },
      })) as ServerFnExecutionResponse<{ id: string; status: string }>;

      expect(response.error).toBeUndefined();
      expect(response.result).toMatchObject({ id: "pi_new", status: "started" });
      expect(mocks.ensurePurchaseIntent).toHaveBeenCalledWith({
        interval: "yearly",
        product: "atlas_pro",
        userId: "user_123",
      });
    });

    it.each([
      ["atlas_pro", "monthly"],
      ["atlas_pro", "yearly"],
      ["atlas_pro", "four_month"],
      ["atlas_team", "monthly"],
      ["atlas_team", "yearly"],
      ["atlas_research_pass", "once"],
      ["atlas_research_pass", "weekly"],
    ])("accepts the %s plan on its %s interval", async (product, interval) => {
      mocks.ensurePurchaseIntent.mockResolvedValue({ id: "pi_ok", status: "started" });

      const { ensurePurchaseOnboarding } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await ensurePurchaseOnboarding.__executeServer({
        method: "POST",
        data: { product, interval },
      })) as ServerFnExecutionResponse;

      expect(response.error).toBeUndefined();
    });

    it.each([
      ["atlas_pro", "once"],
      ["atlas_pro", "weekly"],
      ["atlas_team", "four_month"],
      ["atlas_research_pass", "monthly"],
      ["atlas_research_pass", "yearly"],
    ])("refuses the %s plan on its unavailable %s interval", async (product, interval) => {
      const { ensurePurchaseOnboarding } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await ensurePurchaseOnboarding.__executeServer({
        method: "POST",
        data: { product, interval },
      })) as ServerFnExecutionResponse;

      expect(response.error).toBeInstanceOf(Error);
      expect(mocks.ensurePurchaseIntent).not.toHaveBeenCalled();
    });
  });

  describe("loadPurchaseOnboarding", () => {
    it("returns a purchase that has not reached checkout without calling Stripe", async () => {
      mocks.loadPurchaseIntent.mockResolvedValue({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "pi_early",
        interval: "monthly",
        product: "atlas_pro",
        status: "workspace_ready",
        stripeCheckoutSessionId: null,
        userId: "user_123",
        workspaceId: "org_team",
      });

      const { loadPurchaseOnboarding } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await loadPurchaseOnboarding.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_early" },
      })) as ServerFnExecutionResponse<{ status: string }>;

      expect(response.result?.status).toBe("workspace_ready");
      expect(mocks.reconcilePaidCheckoutSession).not.toHaveBeenCalled();
    });

    it("returns the unchanged purchase when Stripe reports it is still unpaid", async () => {
      mocks.loadPurchaseIntent.mockResolvedValue({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "pi_pending",
        interval: "monthly",
        product: "atlas_pro",
        status: "checkout_created",
        stripeCheckoutSessionId: "cs_pending",
        userId: "user_123",
        workspaceId: "org_team",
      });
      mocks.reconcilePaidCheckoutSession.mockResolvedValue(false);

      const { loadPurchaseOnboarding } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await loadPurchaseOnboarding.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_pending" },
      })) as ServerFnExecutionResponse<{ status: string }>;

      expect(mocks.reconcilePaidCheckoutSession).toHaveBeenCalledWith("cs_pending");
      expect(response.result?.status).toBe("checkout_created");
      expect(mocks.loadPurchaseIntent).toHaveBeenCalledTimes(1);
    });

    it("returns null for a purchase id that does not belong to the operator", async () => {
      mocks.loadPurchaseIntent.mockResolvedValue(null);

      const { loadPurchaseOnboarding } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await loadPurchaseOnboarding.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_absent" },
      })) as ServerFnExecutionResponse;

      expect(response.error).toBeUndefined();
      expect(response.result).toBeNull();
    });
  });

  describe("attachPurchaseWorkspace", () => {
    it("attaches a workspace the operator owns to a fresh purchase", async () => {
      mocks.loadPurchaseIntent.mockResolvedValue({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "pi_123",
        interval: "monthly",
        product: "atlas_team",
        status: "started",
        stripeCheckoutSessionId: null,
        userId: "user_123",
        workspaceId: null,
      });
      mocks.attachWorkspaceToPurchaseIntent.mockResolvedValue({
        id: "pi_123",
        status: "workspace_ready",
        workspaceId: "org_team",
      });

      const { attachPurchaseWorkspace } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await attachPurchaseWorkspace.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_123", workspaceId: "org_team" },
      })) as ServerFnExecutionResponse<{ status: string; workspaceId: string }>;

      expect(response.error).toBeUndefined();
      expect(response.result).toMatchObject({ status: "workspace_ready", workspaceId: "org_team" });
    });

    it("refuses to attach a workspace to a purchase that no longer exists", async () => {
      mocks.loadPurchaseIntent.mockResolvedValue(null);

      const { attachPurchaseWorkspace } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await attachPurchaseWorkspace.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_gone", workspaceId: "org_team" },
      })) as ServerFnExecutionResponse;

      expect(response.error).toBeInstanceOf(Error);
      expect(mocks.attachWorkspaceToPurchaseIntent).not.toHaveBeenCalled();
    });

    it("refuses to attach a workspace to an already-paid purchase", async () => {
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

      const { attachPurchaseWorkspace } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await attachPurchaseWorkspace.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_paid", workspaceId: "org_team" },
      })) as ServerFnExecutionResponse;

      expect(response.error).toBeInstanceOf(Error);
      expect(mocks.attachWorkspaceToPurchaseIntent).not.toHaveBeenCalled();
    });
  });

  describe("startPurchaseCheckout", () => {
    it("refuses to start checkout for a purchase that does not exist", async () => {
      mocks.loadPurchaseIntent.mockResolvedValue(null);

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_gone" },
      })) as ServerFnExecutionResponse;

      expect(response.error).toBeInstanceOf(Error);
      expect((response.error as Error).message).toBe("Atlas could not find that purchase.");
      expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    });

    it("asks for a workspace before taking payment", async () => {
      mocks.loadPurchaseIntent.mockResolvedValue({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "pi_no_workspace",
        interval: "monthly",
        product: "atlas_team",
        status: "workspace_ready",
        stripeCheckoutSessionId: null,
        userId: "user_123",
        workspaceId: null,
      });

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_no_workspace" },
      })) as ServerFnExecutionResponse;

      expect((response.error as Error).message).toBe(
        "Create a workspace before continuing to payment.",
      );
      expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    });

    it("refuses to start checkout when the workspace has since been deleted", async () => {
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
      authApi.getFullOrganization.mockResolvedValue(null);

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_123" },
      })) as ServerFnExecutionResponse;

      expect((response.error as Error).message).toBe("Atlas could not find that workspace.");
      expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    });

    it("reports a failure when Stripe returns a session with no URL to send the buyer to", async () => {
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
      mocks.createCheckoutSession.mockResolvedValue({ id: "cs_123", url: null });

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_123" },
      })) as ServerFnExecutionResponse;

      expect((response.error as Error).message).toBe("Stripe did not return a checkout URL.");
      expect(mocks.markPurchaseCheckoutCreated).not.toHaveBeenCalled();
    });

    it("reuses the Stripe customer already stored on the workspace", async () => {
      mocks.loadPurchaseIntent.mockResolvedValue({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "pi_123",
        interval: "monthly",
        product: "atlas_pro",
        status: "workspace_ready",
        stripeCheckoutSessionId: null,
        userId: "user_123",
        workspaceId: "org_team",
      });
      authApi.getFullOrganization.mockResolvedValue({
        members: [{ id: "member_owner" }],
        metadata: { stripeCustomerId: "cus_existing", workspaceType: "team" },
      });
      mocks.createCheckoutSession.mockResolvedValue({ id: "cs_123", url: "https://pay.test/c" });

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_123" },
      });

      const options = mocks.createCheckoutSession.mock.calls[0]?.[0] as CreateCheckoutOptions;
      expect(options.stripeCustomerId).toBe("cus_existing");
      expect(mocks.ensureStripeCustomerForWorkspace).not.toHaveBeenCalled();
    });

    it("still lets the buyer pay when the Stripe customer could not be created", async () => {
      mocks.loadPurchaseIntent.mockResolvedValue({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "pi_123",
        interval: "monthly",
        product: "atlas_pro",
        status: "workspace_ready",
        stripeCheckoutSessionId: null,
        userId: "user_123",
        workspaceId: "org_team",
      });
      mocks.ensureStripeCustomerForWorkspace.mockRejectedValue(new Error("Stripe was down."));
      mocks.createCheckoutSession.mockResolvedValue({ id: "cs_123", url: "https://pay.test/c" });

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_123" },
      })) as ServerFnExecutionResponse<{ url: string }>;

      // Stripe creates a guest customer from customerEmail, and the
      // checkout.session.completed webhook links it back to the workspace.
      expect(response.result?.url).toBe("https://pay.test/c");
      const options = mocks.createCheckoutSession.mock.calls[0]?.[0] as CreateCheckoutOptions;
      expect(options.stripeCustomerId).toBeNull();
      expect(options.customerEmail).toBe("operator@atlas.test");
    });

    it("bills a seat for every member beyond the owner on a monthly team plan", async () => {
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
      authApi.getFullOrganization.mockResolvedValue({
        members: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
        metadata: { stripeCustomerId: "cus_existing", workspaceType: "team" },
      });
      mocks.createCheckoutSession.mockResolvedValue({ id: "cs_123", url: "https://pay.test/c" });

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_123" },
      });

      const options = mocks.createCheckoutSession.mock.calls[0]?.[0] as CreateCheckoutOptions;
      expect(options.seatQuantity).toBe(2);
      expect(options.seatPriceId).toBe("price_team_seat_monthly");
      expect(options.priceId).toBe("price_team_monthly");
    });

    it("bills yearly seats on a yearly team plan", async () => {
      mocks.loadPurchaseIntent.mockResolvedValue({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "pi_123",
        interval: "yearly",
        product: "atlas_team",
        status: "workspace_ready",
        stripeCheckoutSessionId: null,
        userId: "user_123",
        workspaceId: "org_team",
      });
      authApi.getFullOrganization.mockResolvedValue({
        members: [{ id: "m1" }, { id: "m2" }],
        metadata: { stripeCustomerId: "cus_existing", workspaceType: "team" },
      });
      mocks.createCheckoutSession.mockResolvedValue({ id: "cs_123", url: "https://pay.test/c" });

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_123" },
      });

      const options = mocks.createCheckoutSession.mock.calls[0]?.[0] as CreateCheckoutOptions;
      expect(options.seatPriceId).toBe("price_team_seat_yearly");
      expect(options.priceId).toBe("price_team_yearly");
    });

    it("bills no seats for a solo team workspace", async () => {
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
      mocks.createCheckoutSession.mockResolvedValue({ id: "cs_123", url: "https://pay.test/c" });

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_123" },
      });

      const options = mocks.createCheckoutSession.mock.calls[0]?.[0] as CreateCheckoutOptions;
      expect(options.seatQuantity).toBe(0);
      expect(options.seatPriceId).toBeNull();
    });

    it("bills no seats when the workspace reports no member list", async () => {
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
      authApi.getFullOrganization.mockResolvedValue({
        metadata: { stripeCustomerId: "cus_existing", workspaceType: "team" },
      });
      mocks.createCheckoutSession.mockResolvedValue({ id: "cs_123", url: "https://pay.test/c" });

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_123" },
      });

      const options = mocks.createCheckoutSession.mock.calls[0]?.[0] as CreateCheckoutOptions;
      expect(options.seatQuantity).toBe(0);
      expect(options.seatPriceId).toBeNull();
    });

    it.each([
      ["atlas_pro", "monthly", "price_pro_monthly"],
      ["atlas_pro", "yearly", "price_pro_yearly"],
      ["atlas_pro", "four_month", "price_pro_student_four_month"],
      ["atlas_research_pass", "weekly", "price_pass_weekly"],
      ["atlas_research_pass", "once", "price_pass_once"],
    ])("charges the %s %s plan against %s", async (product, interval, priceId) => {
      mocks.loadPurchaseIntent.mockResolvedValue({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "pi_123",
        interval,
        product,
        status: "workspace_ready",
        stripeCheckoutSessionId: null,
        userId: "user_123",
        workspaceId: "org_team",
      });
      mocks.ensureStripeCustomerForWorkspace.mockResolvedValue("cus_123");
      mocks.createCheckoutSession.mockResolvedValue({ id: "cs_123", url: "https://pay.test/c" });

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_123" },
      });

      const options = mocks.createCheckoutSession.mock.calls[0]?.[0] as CreateCheckoutOptions;
      expect(options.priceId).toBe(priceId);
      expect(options.seatPriceId).toBeNull();
    });
  });
  it("refuses to load the purchase modules if it is ever bundled into the browser", async () => {
    // import.meta.env.SSR is false in a client bundle; the guard exists so a
    // bad import graph fails loudly instead of shipping Stripe keys to a page.
    vi.stubEnv("SSR", "" as never);

    const { ensurePurchaseOnboarding } =
      await import("@/domains/billing/purchase-onboarding.functions");
    const response = (await ensurePurchaseOnboarding.__executeServer({
      method: "POST",
      data: { product: "atlas_pro", interval: "monthly" },
    })) as ServerFnExecutionResponse;

    expect((response.error as Error).message).toBe(
      "Purchase onboarding is only available on the server.",
    );
  });
});
