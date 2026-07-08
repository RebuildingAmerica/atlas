import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
  createBetterAuthInvitation,
  createBetterAuthOrganization,
  createBetterAuthSession,
} from "../../../../../fixtures/access/sessions";
import { createSessionStateAuthApi } from "../../../../../mocks/access/session-state-auth";

const mocks = vi.hoisted(() => ({
  canEmailAccessAtlas: vi.fn(),
  ensureAuthReady: vi.fn(),
  hasExistingAccount: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  validateAuthRuntimeConfig: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  canEmailAccessAtlas: mocks.canEmailAccessAtlas,
  ensureAuthReady: mocks.ensureAuthReady,
  hasExistingAccount: mocks.hasExistingAccount,
}));

vi.mock("@/domains/access/server/request-headers", () => ({
  getBrowserSessionHeaders: mocks.getBrowserSessionHeaders,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
  validateAuthRuntimeConfig: mocks.validateAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/workspace-products", () => ({
  queryActiveProducts: vi.fn().mockResolvedValue([]),
}));

describe("session-state loading", () => {
  const browserSessionHeaders = new Headers({
    cookie: "better-auth.session_token=test-token",
  });

  let authApi = createSessionStateAuthApi();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    authApi = createSessionStateAuthApi();

    mocks.canEmailAccessAtlas.mockResolvedValue(true);
    mocks.ensureAuthReady.mockResolvedValue({ api: authApi });
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: false,
    });
    mocks.validateAuthRuntimeConfig.mockReturnValue(undefined);
  });

  it("returns the local single-operator session when auth is disabled", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: true,
    });

    const localSession = createAtlasSessionFixture({
      isLocal: true,
      sessionId: "local-session",
      user: {
        email: "local@atlas.local",
        emailVerified: true,
        id: "local-operator",
        name: "Local Operator",
      },
      workspace: {
        activeOrganization: {
          id: "local",
          name: "Local Workspace",
          role: "owner",
          slug: "local",
          workspaceType: "individual",
        },
        activeProducts: ["atlas_team"],
        capabilities: {
          canInviteMembers: false,
          canManageOrganization: false,
          canSwitchOrganizations: false,
          canUseTeamFeatures: false,
        },
        resolvedCapabilities: {
          capabilities: [
            "research.run",
            "research.unlimited",
            "workspace.notes",
            "workspace.export",
            "api.keys",
            "api.mcp",
            "workspace.shared",
            "monitoring.watchlists",
            "integrations.slack",
            "auth.sso",
          ],
          limits: {
            research_runs_per_month: null,
            max_shortlists: null,
            max_shortlist_entries: null,
            max_api_keys: null,
            api_requests_per_day: 10000,
            public_api_requests_per_hour: null,
            max_members: 50,
          },
        },
        memberships: [
          {
            id: "local",
            name: "Local Workspace",
            role: "owner",
            slug: "local",
            workspaceType: "individual",
          },
        ],
        onboarding: {
          hasPendingInvitations: false,
          needsWorkspace: false,
        },
        pendingInvitations: [],
      },
    });

    const { loadAtlasSession } = await import("@/domains/access/server/session-state");
    await expect(loadAtlasSession()).resolves.toEqual(localSession);
  });

  it("returns null when auth is enabled and no browser session exists", async () => {
    authApi.getSession.mockResolvedValue(null);

    const { loadAtlasSession } = await import("@/domains/access/server/session-state");
    await expect(loadAtlasSession()).resolves.toBeNull();
  });

  it("maps Better Auth session and passkey state into Atlas session payloads", async () => {
    authApi.getSession.mockResolvedValue(
      createBetterAuthSession({
        activeOrganizationId: "org_team",
      }),
    );
    authApi.listPasskeys.mockResolvedValue([{}, {}]);
    authApi.listOrganizations.mockResolvedValue([
      createBetterAuthOrganization(),
      createBetterAuthOrganization({
        id: "org_personal",
        metadata: { workspaceType: "individual" },
        name: "Operator Studio",
        slug: "operator-studio",
      }),
    ]);
    authApi.getActiveMemberRole.mockImplementation(
      ({ query }: { query?: { organizationId?: string } }) => {
        if (query?.organizationId === "org_team") {
          return Promise.resolve({ role: "owner" });
        }

        return Promise.resolve({ role: "member" });
      },
    );
    authApi.listUserInvitations.mockResolvedValue([createBetterAuthInvitation()]);

    const expectedSession = createAtlasSessionFixture({
      passkeyCount: 2,
      workspace: createAtlasWorkspace({
        capabilities: {
          canSwitchOrganizations: true,
        },
        memberships: [
          {
            id: "org_team",
            name: "Atlas Team",
            role: "owner",
            slug: "atlas-team",
            workspaceType: "team",
          },
          {
            id: "org_personal",
            name: "Operator Studio",
            role: "member",
            slug: "operator-studio",
            workspaceType: "individual",
          },
        ],
        onboarding: {
          hasPendingInvitations: true,
        },
        pendingInvitations: [
          {
            email: "operator@atlas.test",
            expiresAt: "2026-04-20T12:00:00.000Z",
            id: "invite_team_2",
            organizationId: "org_future",
            organizationName: "Research Desk",
            organizationSlug: "research-desk",
            role: "admin",
            workspaceType: "team",
          },
        ],
      }),
    });

    const { loadAtlasSession } = await import("@/domains/access/server/session-state");
    await expect(loadAtlasSession()).resolves.toEqual(expectedSession);

    expect(authApi.getSession).toHaveBeenCalledWith({
      headers: browserSessionHeaders,
    });
    expect(authApi.listPasskeys).toHaveBeenCalledWith({
      headers: browserSessionHeaders,
    });
  });

  it("accepts null active organizations before the operator joins a workspace", async () => {
    authApi.getSession.mockResolvedValue(
      createBetterAuthSession({
        activeOrganizationId: null,
      }),
    );
    authApi.listPasskeys.mockResolvedValue([]);
    authApi.listOrganizations.mockResolvedValue([]);
    authApi.listUserInvitations.mockResolvedValue([]);

    const expectedSession = createAtlasSessionFixture({
      accountReady: true,
      hasPasskey: false,
      passkeyCount: 0,
      workspace: createAtlasWorkspace({
        activeOrganization: null,
        capabilities: {
          canInviteMembers: false,
          canManageOrganization: false,
          canSwitchOrganizations: false,
          canUseTeamFeatures: false,
        },
        memberships: [],
        onboarding: {
          hasPendingInvitations: false,
          needsWorkspace: true,
        },
        pendingInvitations: [],
      }),
    });

    const { loadAtlasSession } = await import("@/domains/access/server/session-state");
    await expect(loadAtlasSession()).resolves.toEqual(expectedSession);
  });
});
