import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";
import { createAtlasSessionFixture } from "../../../fixtures/access/sessions";
import {
  STRIPE_ATLAS_CATALOG_ENV_KEY,
  createStripeAtlasCatalogFixture,
} from "../../../fixtures/billing/stripe-price-envs";

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
  resolveCheckoutAvailability: vi.fn(),
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

vi.mock("@/domains/billing/server/checkout-availability", () => ({
  resolveCheckoutAvailability: mocks.resolveCheckoutAvailability,
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
    mocks.resolveCheckoutAvailability.mockResolvedValue({ available: true, reason: null });
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    mocks.requireReadyAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      members: [{ id: "member_owner" }],
      metadata: { workspaceType: "team" },
    });
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
});
