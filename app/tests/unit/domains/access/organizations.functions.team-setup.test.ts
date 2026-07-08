import { beforeEach, describe, expect, it } from "vitest";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../../../fixtures/access/sessions";
import { authApi, mocks, resetOrganizationFunctionMocks } from "./organizations.functions.mocks";

describe("organizations.functions team setup", () => {
  beforeEach(() => {
    resetOrganizationFunctionMocks();
  });

  it("creates a workspace with a delegated admin invitation and Stripe customer", async () => {
    mocks.ensureReadyAtlasSession.mockResolvedValue(createAtlasSessionFixture());
    authApi.createOrganization.mockResolvedValue({ id: "new_org", slug: "new-workspace" });
    authApi.createInvitation.mockResolvedValue(undefined);

    const { createWorkspace } = await import("@/domains/access/organizations.functions");
    const response = await createWorkspace.__executeServer({
      method: "POST",
      data: {
        delegatedAdminEmail: "delegate@atlas.test",
        name: "New Workspace",
        slug: "new-workspace",
        workspaceDomain: "example.com",
        workspaceType: "team",
      },
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ id: "new_org", slug: "new-workspace" });
    expect(mocks.ensureStripeCustomerForWorkspace).toHaveBeenCalledWith(
      "new_org",
      "operator@atlas.test",
      "New Workspace",
    );
    interface CreateInvitationCall {
      body: {
        email: string;
        organizationId: string;
        role: string;
      };
      headers: Headers;
    }
    const createInvitationCall = authApi.createInvitation.mock.calls[0]?.[0] as
      CreateInvitationCall | undefined;
    expect(createInvitationCall).toMatchObject({
      body: {
        email: "delegate@atlas.test",
        organizationId: "new_org",
        role: "admin",
      },
    });
    expect(createInvitationCall?.headers).toBeInstanceOf(Headers);
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
});
