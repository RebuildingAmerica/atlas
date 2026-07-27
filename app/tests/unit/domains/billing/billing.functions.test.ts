import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";
import { createAtlasSessionFixture } from "../../../fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  ensureAuthReady: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  getStripeClient: vi.fn(),
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

vi.mock("@/domains/billing/server/stripe-client", () => ({
  getStripeClient: mocks.getStripeClient,
}));

describe("billing.functions", () => {
  const browserSessionHeaders = new Headers({ cookie: "test" });
  const portalSessionsCreate = vi.fn();
  const stripeClient = {
    billingPortal: {
      sessions: { create: portalSessionsCreate },
    },
  };
  const authApi = {
    getFullOrganization: vi.fn(),
  };

  beforeEach(() => {
    vi.resetModules();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    portalSessionsCreate.mockReset();
    Object.values(authApi).forEach((mock) => mock.mockReset());

    mocks.getAuthRuntimeConfig.mockReturnValue({ publicBaseUrl: "https://atlas.test" });
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
    mocks.getStripeClient.mockReturnValue(stripeClient);
    mocks.ensureAuthReady.mockResolvedValue({ api: authApi });
  });

  it("creates a Stripe Customer Portal session for the active workspace", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: {
        stripeCustomerId: "cus_123",
        workspaceType: "team",
      },
    });
    portalSessionsCreate.mockResolvedValue({ url: "https://billing.stripe.test/p/session_123" });

    const { createPortalSession } = await import("@/domains/billing/billing.functions");
    const response = (await createPortalSession.__executeServer({
      method: "POST",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ url: "https://billing.stripe.test/p/session_123" });
    expect(portalSessionsCreate).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://atlas.test/account",
    });
  });

  it("rejects portal creation without an active workspace", async () => {
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

    const { createPortalSession } = await import("@/domains/billing/billing.functions");
    const response = (await createPortalSession.__executeServer({
      method: "POST",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("Choose or create a workspace");
  });

  it("rejects portal creation when the workspace has no Stripe customer", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { workspaceType: "team" },
    });

    const { createPortalSession } = await import("@/domains/billing/billing.functions");
    const response = (await createPortalSession.__executeServer({
      method: "POST",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("No billing account");
  });
  it("refuses to load the Stripe modules if it is ever bundled into the browser", async () => {
    // import.meta.env.SSR is false in a client bundle; the guard exists so a
    // bad import graph fails loudly instead of shipping Stripe keys to a page.
    vi.stubEnv("SSR", "" as never);

    const { createPortalSession } = await import("@/domains/billing/billing.functions");
    const response = (await createPortalSession.__executeServer({
      data: undefined,
      method: "POST",
    })) as ServerFnExecutionResponse;

    expect((response.error as Error).message).toBe(
      "Billing server modules are only available on the server.",
    );
  });
});
