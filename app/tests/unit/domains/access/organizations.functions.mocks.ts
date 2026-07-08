import { vi } from "vitest";
import { browserSessionHeaders } from "./organizations.functions.support";

export const mocks = {
  ensureAtlasSession: vi.fn(),
  ensureReadyAtlasSession: vi.fn(),
  ensureAuthReady: vi.fn(),
  ensureStripeCustomerForWorkspace: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  syncTeamSeats: vi.fn(),
  resolveActiveTeamBillingInterval: vi.fn(),
};

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));

vi.mock("@/domains/access/server/session-state", () => ({
  requireAtlasSessionState: mocks.ensureAtlasSession,
  requireReadyAtlasSessionState: mocks.ensureReadyAtlasSession,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/request-headers", () => ({
  getBrowserSessionHeaders: mocks.getBrowserSessionHeaders,
}));

vi.mock("@/domains/billing/server/stripe-customer", () => ({
  ensureStripeCustomerForWorkspace: mocks.ensureStripeCustomerForWorkspace,
}));

vi.mock("@/domains/billing/server/team-seats", () => ({
  syncTeamSeats: mocks.syncTeamSeats,
  resolveActiveTeamBillingInterval: mocks.resolveActiveTeamBillingInterval,
}));

export const authApi = {
  acceptInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
  checkOrganizationSlug: vi.fn(),
  createInvitation: vi.fn(),
  createOrganization: vi.fn(),
  getFullOrganization: vi.fn(),
  leaveOrganization: vi.fn(),
  listSSOProviders: vi.fn(),
  rejectInvitation: vi.fn(),
  removeMember: vi.fn(),
  setActiveOrganization: vi.fn(),
  updateMemberRole: vi.fn(),
  updateOrganization: vi.fn(),
};

export function resetOrganizationFunctionMocks(): void {
  vi.resetModules();
  mocks.ensureAtlasSession.mockReset();
  mocks.ensureReadyAtlasSession.mockReset();
  mocks.ensureAuthReady.mockReset();
  mocks.ensureStripeCustomerForWorkspace.mockReset();
  mocks.getAuthRuntimeConfig.mockReset();
  mocks.getBrowserSessionHeaders.mockReset();
  mocks.syncTeamSeats.mockReset();
  mocks.resolveActiveTeamBillingInterval.mockReset();

  mocks.getAuthRuntimeConfig.mockReturnValue({
    localMode: false,
    publicBaseUrl: "https://atlas.test",
  });
  mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
  mocks.ensureAuthReady.mockResolvedValue({ api: authApi });
  mocks.ensureStripeCustomerForWorkspace.mockResolvedValue("cus_123");
  mocks.syncTeamSeats.mockResolvedValue(undefined);
  mocks.resolveActiveTeamBillingInterval.mockResolvedValue("monthly");

  Object.values(authApi).forEach((mock) => mock.mockReset());
}
