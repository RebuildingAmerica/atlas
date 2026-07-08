import { beforeEach, describe, expect, it } from "vitest";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";
import { authApi, mocks, resetOrganizationFunctionMocks } from "./organizations.functions.mocks";

describe("organizations.functions basics", () => {
  beforeEach(() => {
    resetOrganizationFunctionMocks();
  });

  it("gets organization details", async () => {
    const session = (await import("../../../fixtures/access/sessions")).createAtlasSessionFixture();
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
    const session = (await import("../../../fixtures/access/sessions")).createAtlasSessionFixture();
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
    mocks.ensureAtlasSession.mockResolvedValue(
      (await import("../../../fixtures/access/sessions")).createAtlasSessionFixture(),
    );

    const { setActiveWorkspace } = await import("@/domains/access/organizations.functions");
    const response = (await setActiveWorkspace.__executeServer({
      method: "POST",
      data: { organizationId: "org_123" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
  });

  it("updates workspace profile", async () => {
    authApi.updateOrganization.mockResolvedValue({ id: "org_team" });
    mocks.ensureAtlasSession.mockResolvedValue(
      (await import("../../../fixtures/access/sessions")).createAtlasSessionFixture(),
    );

    const { updateWorkspaceProfile } = await import("@/domains/access/organizations.functions");
    const response = (await updateWorkspaceProfile.__executeServer({
      method: "POST",
      data: { name: "New Name", slug: "new-slug" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
    interface UpdateOrganizationCall {
      body: {
        data: { name: string; slug: string };
        organizationId: string;
      };
      headers: Headers;
    }
    const updateOrganizationCall = authApi.updateOrganization.mock.calls[0]?.[0] as
      UpdateOrganizationCall | undefined;
    expect(updateOrganizationCall).toMatchObject({
      body: {
        data: { name: "New Name", slug: "new-slug" },
        organizationId: "org_team",
      },
    });
    expect(updateOrganizationCall?.headers).toBeInstanceOf(Headers);
  });

  it("leaves a workspace", async () => {
    authApi.leaveOrganization.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(
      (await import("../../../fixtures/access/sessions")).createAtlasSessionFixture({
        role: "admin",
      }),
    );

    const { leaveWorkspace } = await import("@/domains/access/organizations.functions");
    const response = (await leaveWorkspace.__executeServer({
      method: "POST",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ ok: true });
    interface LeaveOrganizationCall {
      body: { organizationId: string };
      headers: Headers;
    }
    const leaveOrganizationCall = authApi.leaveOrganization.mock.calls[0]?.[0] as
      LeaveOrganizationCall | undefined;
    expect(leaveOrganizationCall).toMatchObject({
      body: { organizationId: "org_team" },
    });
    expect(leaveOrganizationCall?.headers).toBeInstanceOf(Headers);
  });

  it("rejects leaving a workspace as owner", async () => {
    mocks.ensureAtlasSession.mockResolvedValue(
      (await import("../../../fixtures/access/sessions")).createAtlasSessionFixture({
        role: "owner",
      }),
    );

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
    const session = (await import("../../../fixtures/access/sessions")).createAtlasSessionFixture({
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
    mocks.ensureAtlasSession.mockResolvedValue(
      (await import("../../../fixtures/access/sessions")).createAtlasSessionFixture(),
    );
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
    mocks.ensureReadyAtlasSession.mockResolvedValue(
      (await import("../../../fixtures/access/sessions")).createAtlasSessionFixture(),
    );
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
    mocks.ensureReadyAtlasSession.mockResolvedValue(
      (await import("../../../fixtures/access/sessions")).createAtlasSessionFixture(),
    );
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
    mocks.ensureReadyAtlasSession.mockResolvedValue(
      (await import("../../../fixtures/access/sessions")).createAtlasSessionFixture(),
    );
    authApi.checkOrganizationSlug.mockResolvedValue({ status: false });

    const { checkWorkspaceSlugAvailability } =
      await import("@/domains/access/organizations.functions");
    const response = (await checkWorkspaceSlugAvailability.__executeServer({
      method: "POST",
      data: { slug: "fresh-team" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toEqual({ available: false });
  });
});
