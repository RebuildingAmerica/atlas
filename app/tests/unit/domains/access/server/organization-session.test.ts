import { describe, expect, it, vi } from "vitest";
import { loadAtlasWorkspaceState } from "@/domains/access/server/organization-session";

type AuthParam = Parameters<typeof loadAtlasWorkspaceState>[0];
type SessionParam = Parameters<typeof loadAtlasWorkspaceState>[2];

describe("organization-session", () => {
  const headers = new Headers();
  const session = {
    session: {
      activeOrganizationId: "org_123",
      id: "sess_123",
      userId: "user_123",
      expiresAt: new Date(),
      token: "test-token",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      id: "user_123",
      email: "operator@atlas.test",
      emailVerified: true,
      name: "Operator",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  it("normalizes Better Auth organizations and invitations into Atlas workspace state", async () => {
    const listOrganizations = vi.fn().mockResolvedValue([
      {
        id: "org_123",
        name: "Atlas",
        slug: "atlas",
        metadata: { workspaceType: "team" },
      },
    ]);
    const getActiveMemberRole = vi.fn().mockResolvedValue({
      role: "owner",
    });
    const listUserInvitations = vi.fn().mockResolvedValue([
      {
        id: "inv_456",
        email: "operator@atlas.test",
        organizationId: "org_456",
        organizationName: "Other Org",
        role: "member",
        status: "pending",
        expiresAt: new Date("2026-05-10T00:00:00.000Z"),
      },
    ]);

    const auth = {
      api: {
        listOrganizations,
        getActiveMemberRole,
        listUserInvitations,
      },
    } as unknown as AuthParam;

    const workspace = await loadAtlasWorkspaceState(
      auth,
      headers,
      session as unknown as SessionParam,
    );

    expect(workspace).toEqual({
      activeOrganization: {
        id: "org_123",
        name: "Atlas",
        role: "owner",
        slug: "atlas",
        workspaceType: "team",
      },
      capabilities: {
        canInviteMembers: true,
        canManageOrganization: true,
        canSwitchOrganizations: false,
        canUseTeamFeatures: true,
      },
      memberships: [
        {
          id: "org_123",
          name: "Atlas",
          role: "owner",
          slug: "atlas",
          workspaceType: "team",
        },
      ],
      onboarding: {
        hasPendingInvitations: true,
        needsWorkspace: false,
      },
      pendingInvitations: [
        {
          email: "operator@atlas.test",
          expiresAt: "2026-05-10T00:00:00.000Z",
          id: "inv_456",
          organizationId: "org_456",
          organizationName: "Other Org",
          organizationSlug: "org_456",
          role: "member",
          workspaceType: "individual",
        },
      ],
    });

    expect(listOrganizations).toHaveBeenCalledWith({ headers });
    expect(getActiveMemberRole).toHaveBeenCalledWith({
      headers,
      query: {
        organizationId: "org_123",
        userId: "user_123",
      },
    });
  });

  it("picks the first membership as active when no active organization is set", async () => {
    const sessionWithoutActive = {
      ...session,
      session: { ...session.session, activeOrganizationId: null },
    };

    const auth = {
      api: {
        listOrganizations: vi
          .fn()
          .mockResolvedValue([{ id: "org_1", name: "Org 1", slug: "org-1" }]),
        getActiveMemberRole: vi.fn().mockResolvedValue({ role: "member" }),
        listUserInvitations: vi.fn().mockResolvedValue([]),
      },
    } as unknown as AuthParam;

    const workspace = await loadAtlasWorkspaceState(
      auth,
      headers,
      sessionWithoutActive as unknown as SessionParam,
    );

    expect(workspace.activeOrganization?.id).toBe("org_1");
  });

  it("identifies when a user needs a workspace", async () => {
    const auth = {
      api: {
        listOrganizations: vi.fn().mockResolvedValue([]),
        listUserInvitations: vi.fn().mockResolvedValue([]),
      },
    } as unknown as AuthParam;

    const workspace = await loadAtlasWorkspaceState(
      auth,
      headers,
      session as unknown as SessionParam,
    );

    expect(workspace.onboarding.needsWorkspace).toBe(true);
    expect(workspace.activeOrganization).toBeNull();
  });
});
