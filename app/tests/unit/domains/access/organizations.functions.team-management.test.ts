import { beforeEach, describe, expect, it } from "vitest";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../../../fixtures/access/sessions";
import {
  fullOrganizationFixture,
  individualWorkspaceSession,
  subscribedTeamSession,
} from "./organizations.functions.support";
import { authApi, mocks, resetOrganizationFunctionMocks } from "./organizations.functions.mocks";

describe("organizations.functions team management", () => {
  beforeEach(() => {
    resetOrganizationFunctionMocks();
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
