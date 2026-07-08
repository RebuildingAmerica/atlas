import { beforeEach, describe, expect, it } from "vitest";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";
import { createAtlasSessionFixture } from "../../../fixtures/access/sessions";
import { authApi, mocks, resetOrganizationFunctionMocks } from "./organizations.functions.mocks";
import { fullOrganizationFixture, subscribedTeamSession } from "./organizations.functions.support";

describe("organizations.functions members", () => {
  beforeEach(() => {
    resetOrganizationFunctionMocks();
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
    const response = await updateWorkspaceMemberRole.__executeServer({
      method: "POST",
      data: { memberId: "mem_123", role: "admin" },
    });

    expect(response.result).toEqual({ ok: true });
    interface UpdateMemberRoleCall {
      body: {
        memberId: string;
        organizationId: string;
        role: string;
      };
      headers: Headers;
    }
    const updateMemberRoleCall = authApi.updateMemberRole.mock.calls[0]?.[0] as
      UpdateMemberRoleCall | undefined;
    expect(updateMemberRoleCall).toMatchObject({
      body: { memberId: "mem_123", organizationId: "org_team", role: "admin" },
    });
    expect(updateMemberRoleCall?.headers).toBeInstanceOf(Headers);
  });

  it("removes a workspace member", async () => {
    authApi.removeMember.mockResolvedValue(undefined);
    mocks.ensureAtlasSession.mockResolvedValue(createAtlasSessionFixture());

    const { removeWorkspaceMember } = await import("@/domains/access/organizations.functions");
    const response = await removeWorkspaceMember.__executeServer({
      method: "POST",
      data: { memberIdOrEmail: "mem_123" },
    });

    expect(response.result).toEqual({ ok: true });
    interface RemoveMemberCall {
      body: {
        memberIdOrEmail: string;
        organizationId: string;
      };
      headers: Headers;
    }
    const removeMemberCall = authApi.removeMember.mock.calls[0]?.[0] as
      RemoveMemberCall | undefined;
    expect(removeMemberCall).toMatchObject({
      body: { memberIdOrEmail: "mem_123", organizationId: "org_team" },
    });
    expect(removeMemberCall?.headers).toBeInstanceOf(Headers);
  });
});
