import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";
import {
  createAtlasResolvedCapabilities,
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "../../../fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  ensureAtlasSession: vi.fn(),
  ensureReadyAtlasSession: vi.fn(),
  ensureAuthReady: vi.fn(),
  ensureStripeCustomerForWorkspace: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  syncTeamSeats: vi.fn(),
  resolveActiveTeamBillingInterval: vi.fn(),
}));

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

describe("organizations.functions", () => {
  const browserSessionHeaders = new Headers({ cookie: "test" });
  const authApi = {
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

  beforeEach(() => {
    vi.resetModules();
    mocks.ensureAtlasSession.mockReset();
    mocks.ensureReadyAtlasSession.mockReset();
    mocks.ensureAuthReady.mockReset();
    mocks.ensureStripeCustomerForWorkspace.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.getBrowserSessionHeaders.mockReset();

    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: false,
      publicBaseUrl: "https://atlas.test",
    });
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
    mocks.ensureAuthReady.mockResolvedValue({ api: authApi });
    mocks.ensureStripeCustomerForWorkspace.mockResolvedValue("cus_123");
    mocks.syncTeamSeats.mockReset();
    mocks.syncTeamSeats.mockResolvedValue(undefined);
    mocks.resolveActiveTeamBillingInterval.mockReset();
    mocks.resolveActiveTeamBillingInterval.mockResolvedValue("monthly");

    Object.values(authApi).forEach((mock) => mock.mockReset());
  });

  function subscribedTeamSession(maxMembers: number | null) {
    return createAtlasSessionFixture({
      workspace: createAtlasWorkspace({
        activeProducts: ["atlas_team"],
        resolvedCapabilities: createAtlasResolvedCapabilities({ max_members: maxMembers }),
      }),
    });
  }

  function individualWorkspaceSession(role: string) {
    return createAtlasSessionFixture({
      workspace: createAtlasWorkspace({
        activeOrganization: {
          id: "org_solo",
          name: "Solo Workspace",
          role,
          slug: "solo-workspace",
          workspaceType: "individual",
        },
      }),
    });
  }

  function fullOrganizationFixture(memberCount: number, invitationStatuses: string[]) {
    return {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      id: "org_team",
      metadata: { workspaceType: "team" },
      name: "Atlas Team",
      slug: "atlas-team",
      members: Array.from({ length: memberCount }, (_, index) => ({
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        id: `mem_${index}`,
        organizationId: "org_team",
        role: "member",
        user: { email: `member${index}@atlas.test`, id: `user_${index}`, name: `Member ${index}` },
        userId: `user_${index}`,
      })),
      invitations: invitationStatuses.map((status, index) => ({
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        email: `invite${index}@atlas.test`,
        expiresAt: new Date("2026-02-01T00:00:00.000Z"),
        id: `pending_${index}`,
        role: "member",
        status,
      })),
    };
  }

  it("gets organization details", async () => {
    const session = createAtlasSessionFixture();
    mocks.ensureAtlasSession.mockResolvedValue(session);

    authApi.getFullOrganization.mockResolvedValue({
      id: "org_team",
      name: "Atlas Team",
      slug: "atlas-team",
      createdAt: new Date(),
      invitations: [],
      members: [],
      metadata: { workspaceType: "team" },
    });
    authApi.listSSOProviders.mockResolvedValue({ providers: [] });

    const { getOrganizationDetails } = await import("@/domains/access/organizations.functions");
    const response = (await getOrganizationDetails.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.result).toBeDefined();
    expect((response.result as { id: string }).id).toBe("org_team");
    expect(authApi.getFullOrganization).toHaveBeenCalled();
  });

  it("creates a workspace", async () => {
    const session = createAtlasSessionFixture();
    mocks.ensureReadyAtlasSession.mockResolvedValue(session);
    authApi.createOrganization.mockResolvedValue({ id: "new_org", slug: "new-workspace" });

    const { createWorkspace } = await import("@/domains/access/organizations.functions");
    const response = (await createWorkspace.__executeServer({
      method: "POST",
      data: { name: "New Workspace", slug: "new-workspace", workspaceType: "team" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ id: "new_org", slug: "new-workspace" });
  });

  it("sets the active workspace", async () => {
    authApi.setActiveOrganization.mockResolvedValue({ id: "org_123" });
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { setActiveWorkspace } = await import("@/domains/access/organizations.functions");
    const response = (await setActiveWorkspace.__executeServer({
      method: "POST",
      data: { organizationId: "org_123" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
  });

  it("updates workspace profile", async () => {
    authApi.updateOrganization.mockResolvedValue({ id: "org_team" });
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { updateWorkspaceProfile } = await import("@/domains/access/organizations.functions");
    const response = (await updateWorkspaceProfile.__executeServer({
      method: "POST",
      data: { name: "New Name", slug: "new-slug" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
    expect(authApi.updateOrganization).toHaveBeenCalledWith({
      body: {
        data: { name: "New Name", slug: "new-slug" },
        organizationId: "org_team",
      },
      headers: browserSessionHeaders,
    });
  });

  it("leaves a workspace", async () => {
    authApi.leaveOrganization.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture({ role: "admin" }));

    const { leaveWorkspace } = await import("@/domains/access/organizations.functions");
    const response = (await leaveWorkspace.__executeServer({
      method: "POST",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
    expect(authApi.leaveOrganization).toHaveBeenCalledWith({
      body: { organizationId: "org_team" },
      headers: browserSessionHeaders,
    });
  });

  it("rejects leaving a workspace as owner", async () => {
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture({ role: "owner" }));

    const { leaveWorkspace } = await import("@/domains/access/organizations.functions");
    const response = (await leaveWorkspace.__executeServer({
      method: "POST",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeDefined();
    expect((response.error as Error).message).toContain(
      "Transfer workspace ownership before leaving",
    );
  });

  it("invites a workspace member", async () => {
    authApi.getFullOrganization.mockResolvedValue(fullOrganizationFixture(1, []));
    authApi.createInvitation.mockResolvedValue({
      id: "inv_123",
      status: "pending",
      email: "new@atlas.test",
      role: "member",
      organizationId: "org_team",
      createdAt: new Date(),
      expiresAt: new Date(),
    });
    mocks.ensureAtlasSession.mockResolvedValue(subscribedTeamSession(50));

    const { inviteWorkspaceMember } = await import("@/domains/access/organizations.functions");
    const response = (await inviteWorkspaceMember.__executeServer({
      method: "POST",
      data: { email: "new@atlas.test", role: "member" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ id: "inv_123", status: "pending" });
  });

  it("rejects inviting without an active Atlas Team subscription", async () => {
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { inviteWorkspaceMember } = await import("@/domains/access/organizations.functions");
    const response = (await inviteWorkspaceMember.__executeServer({
      method: "POST",
      data: { email: "new@atlas.test", role: "member" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("Subscribe to Atlas Team");
    expect(authApi.getFullOrganization).not.toHaveBeenCalled();
    expect(authApi.createInvitation).not.toHaveBeenCalled();
  });

  it("rejects inviting when the workspace has reached its member limit", async () => {
    authApi.getFullOrganization.mockResolvedValue(fullOrganizationFixture(3, []));
    mocks.ensureAtlasSession.mockResolvedValue(subscribedTeamSession(3));

    const { inviteWorkspaceMember } = await import("@/domains/access/organizations.functions");
    const response = (await inviteWorkspaceMember.__executeServer({
      method: "POST",
      data: { email: "new@atlas.test", role: "member" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("reached its limit");
    expect(authApi.createInvitation).not.toHaveBeenCalled();
  });

  it("counts pending invitations toward the member limit", async () => {
    authApi.getFullOrganization.mockResolvedValue(fullOrganizationFixture(2, ["pending"]));
    mocks.ensureAtlasSession.mockResolvedValue(subscribedTeamSession(3));

    const { inviteWorkspaceMember } = await import("@/domains/access/organizations.functions");
    const response = (await inviteWorkspaceMember.__executeServer({
      method: "POST",
      data: { email: "new@atlas.test", role: "member" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("reached its limit");
  });

  it("ignores non-pending invitations when counting toward the member limit", async () => {
    authApi.getFullOrganization.mockResolvedValue(fullOrganizationFixture(2, ["canceled"]));
    authApi.createInvitation.mockResolvedValue({
      id: "inv_ok",
      status: "pending",
      email: "new@atlas.test",
      role: "member",
      organizationId: "org_team",
      createdAt: new Date(),
      expiresAt: new Date(),
    });
    mocks.ensureAtlasSession.mockResolvedValue(subscribedTeamSession(3));

    const { inviteWorkspaceMember } = await import("@/domains/access/organizations.functions");
    const response = (await inviteWorkspaceMember.__executeServer({
      method: "POST",
      data: { email: "new@atlas.test", role: "member" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(authApi.createInvitation).toHaveBeenCalled();
  });

  it("allows inviting when the member limit is unbounded", async () => {
    authApi.createInvitation.mockResolvedValue({
      id: "inv_unbounded",
      status: "pending",
      email: "new@atlas.test",
      role: "member",
      organizationId: "org_team",
      createdAt: new Date(),
      expiresAt: new Date(),
    });
    mocks.ensureAtlasSession.mockResolvedValue(subscribedTeamSession(null));

    const { inviteWorkspaceMember } = await import("@/domains/access/organizations.functions");
    const response = (await inviteWorkspaceMember.__executeServer({
      method: "POST",
      data: { email: "new@atlas.test", role: "member" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(authApi.getFullOrganization).not.toHaveBeenCalled();
  });

  it("invites when the organization record cannot be loaded for the limit check", async () => {
    authApi.getFullOrganization.mockResolvedValue(null);
    authApi.createInvitation.mockResolvedValue({
      id: "inv_nullorg",
      status: "pending",
      email: "new@atlas.test",
      role: "member",
      organizationId: "org_team",
      createdAt: new Date(),
      expiresAt: new Date(),
    });
    mocks.ensureAtlasSession.mockResolvedValue(subscribedTeamSession(3));

    const { inviteWorkspaceMember } = await import("@/domains/access/organizations.functions");
    const response = (await inviteWorkspaceMember.__executeServer({
      method: "POST",
      data: { email: "new@atlas.test", role: "member" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(authApi.createInvitation).toHaveBeenCalled();
  });

  it("cancels a workspace invitation", async () => {
    authApi.cancelInvitation.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { cancelWorkspaceInvitation } = await import("@/domains/access/organizations.functions");
    const response = (await cancelWorkspaceInvitation.__executeServer({
      method: "POST",
      data: { invitationId: "inv_123" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
  });

  it("accepts a workspace invitation", async () => {
    authApi.acceptInvitation.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { acceptWorkspaceInvitation } = await import("@/domains/access/organizations.functions");
    const response = (await acceptWorkspaceInvitation.__executeServer({
      method: "POST",
      data: { invitationId: "inv_123" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
  });

  it("rejects a workspace invitation", async () => {
    authApi.rejectInvitation.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { rejectWorkspaceInvitation } = await import("@/domains/access/organizations.functions");
    const response = (await rejectWorkspaceInvitation.__executeServer({
      method: "POST",
      data: { invitationId: "inv_123" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
  });

  it("updates workspace member role", async () => {
    authApi.updateMemberRole.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { updateWorkspaceMemberRole } = await import("@/domains/access/organizations.functions");
    const response = (await updateWorkspaceMemberRole.__executeServer({
      method: "POST",
      data: { memberId: "mem_123", role: "admin" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
    expect(authApi.updateMemberRole).toHaveBeenCalledWith({
      body: { memberId: "mem_123", organizationId: "org_team", role: "admin" },
      headers: browserSessionHeaders,
    });
  });

  it("removes a workspace member", async () => {
    authApi.removeMember.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { removeWorkspaceMember } = await import("@/domains/access/organizations.functions");
    const response = (await removeWorkspaceMember.__executeServer({
      method: "POST",
      data: { memberIdOrEmail: "mem_123" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
    expect(authApi.removeMember).toHaveBeenCalledWith({
      body: { memberIdOrEmail: "mem_123", organizationId: "org_team" },
      headers: browserSessionHeaders,
    });
  });

  it("rejects organization management in local mode", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: true });

    const { createWorkspace } = await import("@/domains/access/organizations.functions");
    const response = (await createWorkspace.__executeServer({
      method: "POST",
      data: { name: "New Workspace", slug: "new-workspace", workspaceType: "team" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeDefined();
    expect((response.error as Error).message).toContain("Organization management is unavailable");
  });

  it("returns organization details as null when no active workspace exists", async () => {
    const session = createAtlasSessionFixture({
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
    });
    mocks.ensureAtlasSession.mockResolvedValue(session);

    const { getOrganizationDetails } = await import("@/domains/access/organizations.functions");
    const response = (await getOrganizationDetails.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toBeNull();
    expect(authApi.getFullOrganization).not.toHaveBeenCalled();
  });

  it("returns organization details as null when Better Auth has no record", async () => {
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());
    authApi.getFullOrganization.mockResolvedValue(null);
    authApi.listSSOProviders.mockResolvedValue({ providers: [] });

    const { getOrganizationDetails } = await import("@/domains/access/organizations.functions");
    const response = (await getOrganizationDetails.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toBeNull();
  });

  it("reports an available workspace slug when Better Auth approves it", async () => {
    mocks.ensureReadyAtlasSession.mockResolvedValue(createAtlasSessionFixture());
    authApi.checkOrganizationSlug.mockResolvedValue({ status: true });

    const { checkWorkspaceSlugAvailability } =
      await import("@/domains/access/organizations.functions");
    const response = (await checkWorkspaceSlugAvailability.__executeServer({
      method: "POST",
      data: { slug: "fresh-team" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ available: true });
  });

  it("reports an unavailable workspace slug when Better Auth rejects it", async () => {
    mocks.ensureReadyAtlasSession.mockResolvedValue(createAtlasSessionFixture());
    authApi.checkOrganizationSlug.mockRejectedValue(new Error("ORGANIZATION_SLUG_IS_TAKEN"));

    const { checkWorkspaceSlugAvailability } =
      await import("@/domains/access/organizations.functions");
    const response = (await checkWorkspaceSlugAvailability.__executeServer({
      method: "POST",
      data: { slug: "fresh-team" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ available: false });
  });

  it("reports an unavailable workspace slug when Better Auth returns a non-true status", async () => {
    mocks.ensureReadyAtlasSession.mockResolvedValue(createAtlasSessionFixture());
    authApi.checkOrganizationSlug.mockResolvedValue({ status: false });

    const { checkWorkspaceSlugAvailability } =
      await import("@/domains/access/organizations.functions");
    const response = (await checkWorkspaceSlugAvailability.__executeServer({
      method: "POST",
      data: { slug: "fresh-team" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ available: false });
  });

  it("creates a workspace with a delegated admin invitation and Stripe customer", async () => {
    mocks.ensureReadyAtlasSession.mockResolvedValue(createAtlasSessionFixture());
    authApi.createOrganization.mockResolvedValue({ id: "new_org", slug: "new-workspace" });
    authApi.createInvitation.mockResolvedValue(undefined);

    const { createWorkspace } = await import("@/domains/access/organizations.functions");
    const response = (await createWorkspace.__executeServer({
      method: "POST",
      data: {
        delegatedAdminEmail: "delegate@atlas.test",
        name: "New Workspace",
        slug: "new-workspace",
        workspaceDomain: "example.com",
        workspaceType: "team",
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ id: "new_org", slug: "new-workspace" });
    expect(mocks.ensureStripeCustomerForWorkspace).toHaveBeenCalledWith(
      "new_org",
      "operator@atlas.test",
      "New Workspace",
    );
    expect(authApi.createInvitation).toHaveBeenCalledWith({
      body: {
        email: "delegate@atlas.test",
        organizationId: "new_org",
        role: "admin",
      },
      headers: browserSessionHeaders,
    });
  });

  it("creates a workspace even when Stripe customer pre-creation throws", async () => {
    mocks.ensureReadyAtlasSession.mockResolvedValue(createAtlasSessionFixture());
    authApi.createOrganization.mockResolvedValue({ id: "new_org", slug: "new-workspace" });
    mocks.ensureStripeCustomerForWorkspace.mockRejectedValue(new Error("Stripe down"));

    const { createWorkspace } = await import("@/domains/access/organizations.functions");
    const response = (await createWorkspace.__executeServer({
      method: "POST",
      data: { name: "New Workspace", slug: "new-workspace", workspaceType: "team" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ id: "new_org", slug: "new-workspace" });
  });

  it("creates a workspace even when delegated invitation delivery fails", async () => {
    mocks.ensureReadyAtlasSession.mockResolvedValue(createAtlasSessionFixture());
    authApi.createOrganization.mockResolvedValue({ id: "new_org", slug: "new-workspace" });
    authApi.createInvitation.mockRejectedValue(new Error("SMTP down"));

    const { createWorkspace } = await import("@/domains/access/organizations.functions");
    const response = (await createWorkspace.__executeServer({
      method: "POST",
      data: {
        delegatedAdminEmail: "delegate@atlas.test",
        name: "New Workspace",
        slug: "new-workspace",
        workspaceType: "team",
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
  });

  it("syncs Team seats for the joined workspace after accepting an invitation", async () => {
    authApi.acceptInvitation.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(
      createAtlasSessionFixture({
        workspace: createAtlasWorkspace({
          pendingInvitations: [
            {
              email: "operator@atlas.test",
              expiresAt: null,
              id: "inv_123",
              organizationId: "org_invited",
              organizationName: "Invited Team",
              organizationSlug: "invited-team",
              role: "member",
              workspaceType: "team",
            },
          ],
        }),
      }),
    );

    const { acceptWorkspaceInvitation } = await import("@/domains/access/organizations.functions");
    const response = (await acceptWorkspaceInvitation.__executeServer({
      method: "POST",
      data: { invitationId: "inv_123" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
    expect(mocks.syncTeamSeats).toHaveBeenCalledWith("org_invited");
  });

  it("does not sync seats when the accepted invitation is not in the session", async () => {
    authApi.acceptInvitation.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { acceptWorkspaceInvitation } = await import("@/domains/access/organizations.functions");
    const response = (await acceptWorkspaceInvitation.__executeServer({
      method: "POST",
      data: { invitationId: "inv_unknown" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
    expect(mocks.syncTeamSeats).not.toHaveBeenCalled();
  });

  it("still accepts an invitation when seat sync fails", async () => {
    authApi.acceptInvitation.mockResolvedValue(undefined);
    mocks.syncTeamSeats.mockRejectedValue(new Error("Stripe down"));
    mocks.ensureAtlasSession.mockResolvedValue(
      createAtlasSessionFixture({
        workspace: createAtlasWorkspace({
          pendingInvitations: [
            {
              email: "operator@atlas.test",
              expiresAt: null,
              id: "inv_123",
              organizationId: "org_invited",
              organizationName: "Invited Team",
              organizationSlug: "invited-team",
              role: "member",
              workspaceType: "team",
            },
          ],
        }),
      }),
    );

    const { acceptWorkspaceInvitation } = await import("@/domains/access/organizations.functions");
    const response = (await acceptWorkspaceInvitation.__executeServer({
      method: "POST",
      data: { invitationId: "inv_123" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ ok: true });
  });

  it("syncs Team seats after removing a member", async () => {
    authApi.removeMember.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { removeWorkspaceMember } = await import("@/domains/access/organizations.functions");
    await removeWorkspaceMember.__executeServer({
      method: "POST",
      data: { memberIdOrEmail: "mem_123" },
    });

    expect(mocks.syncTeamSeats).toHaveBeenCalledWith("org_team");
  });

  it("syncs Team seats after leaving a workspace", async () => {
    authApi.leaveOrganization.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture({ role: "admin" }));

    const { leaveWorkspace } = await import("@/domains/access/organizations.functions");
    await leaveWorkspace.__executeServer({ method: "POST", data: undefined });

    expect(mocks.syncTeamSeats).toHaveBeenCalledWith("org_team");
  });

  it("returns a computed Team seat-cost summary and reconciles seats for an active subscription", async () => {
    mocks.ensureAtlasSession.mockResolvedValue(subscribedTeamSession(50));
    mocks.resolveActiveTeamBillingInterval.mockResolvedValue("monthly");
    authApi.getFullOrganization.mockResolvedValue(fullOrganizationFixture(2, []));

    const { getTeamSeatCostSummary } = await import("@/domains/access/organizations.functions");
    const response = (await getTeamSeatCostSummary.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      interval: "monthly",
      seatsUsed: 2,
      additionalSeats: 1,
      totalCents: 3300,
    });
    expect(mocks.syncTeamSeats).toHaveBeenCalledWith("org_team");
  });

  it("returns no seat-cost summary when the team workspace has no active subscription", async () => {
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { getTeamSeatCostSummary } = await import("@/domains/access/organizations.functions");
    const response = (await getTeamSeatCostSummary.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.result).toBeNull();
    expect(authApi.getFullOrganization).not.toHaveBeenCalled();
    expect(mocks.syncTeamSeats).not.toHaveBeenCalled();
  });

  it("returns no seat-cost summary when the active workspace is not a team", async () => {
    mocks.ensureAtlasSession.mockResolvedValue(individualWorkspaceSession("owner"));

    const { getTeamSeatCostSummary } = await import("@/domains/access/organizations.functions");
    const response = (await getTeamSeatCostSummary.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.result).toBeNull();
    expect(authApi.getFullOrganization).not.toHaveBeenCalled();
  });

  it("returns no seat-cost summary when there is no active workspace", async () => {
    mocks.ensureAtlasSession.mockResolvedValue(
      createAtlasSessionFixture({ workspace: createAtlasWorkspace({ activeOrganization: null }) }),
    );

    const { getTeamSeatCostSummary } = await import("@/domains/access/organizations.functions");
    const response = (await getTeamSeatCostSummary.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.result).toBeNull();
  });

  it("returns no seat-cost summary when the organization record cannot be loaded", async () => {
    mocks.ensureAtlasSession.mockResolvedValue(subscribedTeamSession(50));
    authApi.getFullOrganization.mockResolvedValue(null);

    const { getTeamSeatCostSummary } = await import("@/domains/access/organizations.functions");
    const response = (await getTeamSeatCostSummary.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.result).toBeNull();
  });

  it("upgrades an individual workspace to a team in place", async () => {
    authApi.getFullOrganization.mockResolvedValue({
      metadata: { workspaceType: "individual", stripeCustomerId: "cus_x" },
    });
    authApi.updateOrganization.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(individualWorkspaceSession("owner"));

    const { convertWorkspaceToTeam } = await import("@/domains/access/organizations.functions");
    const response = (await convertWorkspaceToTeam.__executeServer({
      method: "POST",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ ok: true });
    interface UpdateOrganizationCall {
      body: { data: { metadata: { workspaceType: string; stripeCustomerId: string | null } } };
    }
    const call = authApi.updateOrganization.mock.calls[0]?.[0] as
      UpdateOrganizationCall | undefined;
    expect(call?.body.data.metadata.workspaceType).toBe("team");
    expect(call?.body.data.metadata.stripeCustomerId).toBe("cus_x");
  });

  it("rejects upgrading a workspace that is already a team", async () => {
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { convertWorkspaceToTeam } = await import("@/domains/access/organizations.functions");
    const response = (await convertWorkspaceToTeam.__executeServer({
      method: "POST",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("already a team");
    expect(authApi.updateOrganization).not.toHaveBeenCalled();
  });

  it("rejects upgrading a workspace without manage permission", async () => {
    mocks.ensureAtlasSession.mockResolvedValue(individualWorkspaceSession("member"));

    const { convertWorkspaceToTeam } = await import("@/domains/access/organizations.functions");
    const response = (await convertWorkspaceToTeam.__executeServer({
      method: "POST",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("permission");
    expect(authApi.updateOrganization).not.toHaveBeenCalled();
  });

  it("upgrades to a team even when the organization record cannot be loaded", async () => {
    authApi.getFullOrganization.mockResolvedValue(null);
    authApi.updateOrganization.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(individualWorkspaceSession("admin"));

    const { convertWorkspaceToTeam } = await import("@/domains/access/organizations.functions");
    const response = (await convertWorkspaceToTeam.__executeServer({
      method: "POST",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    interface UpdateOrganizationCall {
      body: { data: { metadata: { workspaceType: string } } };
    }
    const call = authApi.updateOrganization.mock.calls[0]?.[0] as
      UpdateOrganizationCall | undefined;
    expect(call?.body.data.metadata.workspaceType).toBe("team");
  });

  it("resends a pending invitation atomically without cancelling it", async () => {
    authApi.createInvitation.mockResolvedValue({
      id: "inv_1",
      status: "pending",
      email: "teammate@atlas.test",
      role: "member",
      organizationId: "org_team",
      createdAt: new Date(),
      expiresAt: new Date(),
    });
    mocks.ensureAtlasSession.mockResolvedValue(subscribedTeamSession(50));

    const { resendWorkspaceInvitation } = await import("@/domains/access/organizations.functions");
    const response = (await resendWorkspaceInvitation.__executeServer({
      method: "POST",
      data: { email: "teammate@atlas.test", role: "member" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
    expect(authApi.cancelInvitation).not.toHaveBeenCalled();
    interface CreateInvitationCall {
      body: { resend?: boolean; email: string };
    }
    const call = authApi.createInvitation.mock.calls[0]?.[0] as CreateInvitationCall | undefined;
    expect(call?.body.resend).toBe(true);
    expect(call?.body.email).toBe("teammate@atlas.test");
  });

  it("rejects resending an invitation without an active Atlas Team subscription", async () => {
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { resendWorkspaceInvitation } = await import("@/domains/access/organizations.functions");
    const response = (await resendWorkspaceInvitation.__executeServer({
      method: "POST",
      data: { email: "teammate@atlas.test", role: "member" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("Subscribe to Atlas Team");
    expect(authApi.createInvitation).not.toHaveBeenCalled();
  });
});
