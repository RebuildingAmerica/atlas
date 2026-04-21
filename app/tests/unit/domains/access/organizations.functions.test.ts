import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFnExecutionResponse } from "../../../utils/server-fn-stub";
import { createAtlasSessionFixture } from "../../../fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  ensureAtlasSession: vi.fn(),
  ensureReadyAtlasSession: vi.fn(),
  ensureAuthReady: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
}));

type MockHandler = (args: Record<string, unknown>) => Promise<unknown>;

vi.mock("@tanstack/react-start", () => {
  return {
    createServerFn: () => {
      const builder = {
        inputValidator: () => builder,
        middleware: () => builder,
        handler: (h: MockHandler) => {
          const fn = async (args: Record<string, unknown> = {}) => {
            return h(args);
          };
          return Object.assign(fn, {
            __executeServer: async (args: Record<string, unknown> = {}) => {
              try {
                const res = await h(args);
                return { result: res };
              } catch (error) {
                return { error };
              }
            },
          });
        },
      };
      return builder;
    },
  };
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

describe("organizations.functions", () => {
  const browserSessionHeaders = new Headers({ cookie: "test" });
  const authApi = {
    acceptInvitation: vi.fn(),
    cancelInvitation: vi.fn(),
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
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.getBrowserSessionHeaders.mockReset();

    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: false,
      publicBaseUrl: "https://atlas.test",
    });
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
    mocks.ensureAuthReady.mockResolvedValue({ api: authApi });

    Object.values(authApi).forEach((mock) => mock.mockReset());
  });

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
    authApi.getFullOrganization.mockResolvedValue({ id: "org_team" });
    authApi.createInvitation.mockResolvedValue({
      id: "inv_123",
      status: "pending",
      email: "new@atlas.test",
      role: "member",
      organizationId: "org_team",
      createdAt: new Date(),
      expiresAt: new Date(),
    });
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { inviteWorkspaceMember } = await import("@/domains/access/organizations.functions");
    const response = (await inviteWorkspaceMember.__executeServer({
      method: "POST",
      data: { email: "new@atlas.test", role: "member" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ id: "inv_123", status: "pending" });
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
});
