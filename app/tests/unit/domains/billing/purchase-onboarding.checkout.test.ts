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
});
