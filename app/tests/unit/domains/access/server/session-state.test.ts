import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
  createBetterAuthInvitation,
  createBetterAuthOrganization,
  createBetterAuthSession,
} from "../../../../fixtures/access/sessions";
import { createSessionStateAuthApi } from "../../../../mocks/access/session-state-auth";

const mocks = vi.hoisted(() => ({
  canEmailAccessAtlas: vi.fn(),
  ensureAuthReady: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  validateAuthRuntimeConfig: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  canEmailAccessAtlas: mocks.canEmailAccessAtlas,
  ensureAuthReady: mocks.ensureAuthReady,
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

describe("session-state", () => {
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
          id: "local-workspace",
          name: "Local Workspace",
          role: "owner",
          slug: "local",
          workspaceType: "individual",
        },
        activeProducts: [],
        capabilities: {
          canInviteMembers: false,
          canManageOrganization: false,
          canSwitchOrganizations: false,
          canUseTeamFeatures: false,
        },
        resolvedCapabilities: {
          capabilities: ["research.run"],
          limits: {
            research_runs_per_month: 2,
            max_shortlists: 1,
            max_shortlist_entries: 25,
            max_api_keys: 0,
            api_requests_per_day: 0,
            public_api_requests_per_hour: 100,
            max_members: 1,
          },
        },
        memberships: [
          {
            id: "local-workspace",
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
      // accountReady tracks email verification only; passkey enrollment is
      // recommended but optional, so a verified email with no passkey is
      // still considered ready for resource creation.
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

  it("rejects unauthorized session requirements", async () => {
    authApi.getSession.mockResolvedValue(null);

    const { requireAtlasSessionState } = await import("@/domains/access/server/session-state");
    await expect(requireAtlasSessionState()).rejects.toThrow("Unauthorized");
  });

  it("rejects incomplete session requirements until account setup finishes", async () => {
    authApi.getSession.mockResolvedValue(
      createBetterAuthSession({
        emailVerified: false,
      }),
    );
    authApi.listPasskeys.mockResolvedValue([]);

    const { requireReadyAtlasSessionState } = await import("@/domains/access/server/session-state");
    await expect(requireReadyAtlasSessionState()).rejects.toThrow(
      "Complete account setup before creating Atlas resources.",
    );
  });

  it("returns ready session requirements once account setup is complete", async () => {
    authApi.getSession.mockResolvedValue(createBetterAuthSession());
    authApi.listPasskeys.mockResolvedValue([{}]);

    const readySession = createAtlasSessionFixture();

    const { requireReadyAtlasSessionState } = await import("@/domains/access/server/session-state");
    await expect(requireReadyAtlasSessionState()).resolves.toEqual(readySession);
  });

  it("rejects magic-link requests while auth is disabled", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: true,
    });

    const { requestMagicLinkForEmail } = await import("@/domains/access/server/session-state");
    await expect(
      requestMagicLinkForEmail({
        email: "operator@atlas.test",
      }),
    ).rejects.toThrow("Auth is disabled in local mode.");
  });

  it("hides auth misconfiguration behind a temporary sign-in error", async () => {
    mocks.validateAuthRuntimeConfig.mockImplementation(() => {
      throw new Error("missing config");
    });

    const { requestMagicLinkForEmail } = await import("@/domains/access/server/session-state");
    await expect(
      requestMagicLinkForEmail({
        email: "operator@atlas.test",
      }),
    ).rejects.toThrow("Sign-in is temporarily unavailable.");
  });

  it("returns success without touching auth for emails without workspace access", async () => {
    mocks.canEmailAccessAtlas.mockResolvedValue(false);

    const { requestMagicLinkForEmail } = await import("@/domains/access/server/session-state");
    await expect(
      requestMagicLinkForEmail({
        email: "outside@atlas.test",
      }),
    ).resolves.toEqual({ ok: true });

    expect(mocks.ensureAuthReady).not.toHaveBeenCalled();
  });

  it("starts the Better Auth magic-link flow for allowlisted or invited emails", async () => {
    const { requestMagicLinkForEmail } = await import("@/domains/access/server/session-state");
    await expect(
      requestMagicLinkForEmail({
        callbackURL: "/account",
        email: "operator@atlas.test",
        name: "Operator",
      }),
    ).resolves.toEqual({ ok: true });

    expect(authApi.signInMagicLink).toHaveBeenCalledWith({
      body: {
        callbackURL: "/account",
        email: "operator@atlas.test",
        name: "Operator",
      },
      headers: browserSessionHeaders,
    });
  });

  it("returns success immediately when local mode requests verification email delivery", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: true,
    });

    const { sendVerificationEmailForCurrentSession } =
      await import("@/domains/access/server/session-state");
    await expect(sendVerificationEmailForCurrentSession()).resolves.toEqual({ ok: true });
  });

  it("skips verification delivery for already-verified operators", async () => {
    authApi.getSession.mockResolvedValue(createBetterAuthSession());

    const { sendVerificationEmailForCurrentSession } =
      await import("@/domains/access/server/session-state");
    await expect(sendVerificationEmailForCurrentSession()).resolves.toEqual({ ok: true });

    expect(authApi.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("sends verification email for unverified signed-in operators", async () => {
    authApi.getSession.mockResolvedValue(
      createBetterAuthSession({
        emailVerified: false,
      }),
    );

    const { sendVerificationEmailForCurrentSession } =
      await import("@/domains/access/server/session-state");
    await expect(sendVerificationEmailForCurrentSession()).resolves.toEqual({ ok: true });

    expect(authApi.sendVerificationEmail).toHaveBeenCalledWith({
      body: {
        callbackURL: "/account-setup",
        email: "operator@atlas.test",
      },
      headers: browserSessionHeaders,
    });
  });
});
