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

  describe("checkout availability guard", () => {
    it("reports the funnel state for the pricing page", async () => {
      mocks.resolveCheckoutAvailability.mockResolvedValue({
        available: false,
        reason: "catalog_unavailable",
      });

      const { loadCheckoutAvailability } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await loadCheckoutAvailability.__executeServer({
        method: "GET",
        data: undefined,
      })) as ServerFnExecutionResponse<{ available: boolean; reason: string | null }>;

      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({ available: false, reason: "catalog_unavailable" });
    });

    it("refuses to open a purchase intent while an operator has checkout paused", async () => {
      mocks.resolveCheckoutAvailability.mockResolvedValue({
        available: false,
        reason: "disabled",
      });

      const { ensurePurchaseOnboarding } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await ensurePurchaseOnboarding.__executeServer({
        method: "POST",
        data: { product: "atlas_pro", interval: "monthly" },
      })) as ServerFnExecutionResponse;

      expect(response.error).toBeDefined();
      expect(mocks.ensurePurchaseIntent).not.toHaveBeenCalled();
    });

    it("still refuses when the result carries no reason", async () => {
      // Gating the throw on the reason let an unavailable result reach Stripe.
      mocks.resolveCheckoutAvailability.mockResolvedValue({
        available: false,
        reason: null,
      });

      const { ensurePurchaseOnboarding } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await ensurePurchaseOnboarding.__executeServer({
        method: "POST",
        data: { product: "atlas_pro", interval: "monthly" },
      })) as ServerFnExecutionResponse;

      expect(response.error).toBeDefined();
      expect(mocks.ensurePurchaseIntent).not.toHaveBeenCalled();
    });

    it("refuses to create a Stripe session while the catalog cannot serve", async () => {
      mocks.resolveCheckoutAvailability.mockResolvedValue({
        available: false,
        reason: "catalog_unavailable",
      });

      const { startPurchaseCheckout } =
        await import("@/domains/billing/purchase-onboarding.functions");
      const response = (await startPurchaseCheckout.__executeServer({
        method: "POST",
        data: { purchaseId: "pi_123" },
      })) as ServerFnExecutionResponse;

      expect(response.error).toBeDefined();
      // The refusal must land before Stripe is touched, not after.
      expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    });
  });

  describe("checkout refusal messages", () => {
    it("recognises only the guard's own wording", async () => {
      const { isCheckoutRefusalMessage, CHECKOUT_UNAVAILABLE_FALLBACK } =
        await import("@/domains/billing/purchase-onboarding.functions");

      expect(isCheckoutRefusalMessage(CHECKOUT_UNAVAILABLE_FALLBACK)).toBe(true);
      expect(isCheckoutRefusalMessage("Atlas is not selling subscriptions right now.")).toBe(true);
      // Internal failures must not reach a buyer: this one names an env var.
      expect(
        isCheckoutRefusalMessage("ATLAS_SERVER_API_PROXY_TARGET is required for Atlas API calls."),
      ).toBe(false);
      expect(isCheckoutRefusalMessage("")).toBe(false);
    });

    it("refuses to read availability from the browser bundle", async () => {
      vi.stubEnv("SSR", false);
      vi.resetModules();
      const { loadCheckoutAvailability } =
        await import("@/domains/billing/purchase-onboarding.functions");

      const response = (await loadCheckoutAvailability.__executeServer({
        method: "GET",
        data: undefined,
      })) as ServerFnExecutionResponse;

      expect(response.error).toBeDefined();
    });
  });
});
