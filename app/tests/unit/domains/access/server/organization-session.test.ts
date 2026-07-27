import { describe, expect, it, vi } from "vitest";
import { loadAtlasWorkspaceState } from "@/domains/access/server/organization-session";

vi.mock("@/domains/access/server/workspace-products", () => ({
  queryActiveProducts: vi.fn().mockResolvedValue([]),
}));

describe("organization-session", () => {
  type AuthParam = Parameters<typeof loadAtlasWorkspaceState>[0];

  /** The personal-workspace creation call Atlas sends to Better Auth. */
  interface CreateOrganizationCall {
    body: {
      keepCurrentActiveOrganization: boolean;
      metadata: { onboarding: { provisionedAt: string }; workspaceType: string };
      name: string;
      slug: string;
      userId: string;
    };
    headers: Headers;
  }

  /** The organization row Better Auth answers that call with. */
  interface CreatedOrganization {
    id: string;
    metadata: { workspaceType: string };
    name: string;
    slug: string;
  }

  type CreateOrganization = (call: CreateOrganizationCall) => Promise<CreatedOrganization>;

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

    const workspace = await loadAtlasWorkspaceState(auth, headers, session);

    expect(workspace).toEqual({
      activeOrganization: {
        id: "org_123",
        name: "Atlas",
        role: "owner",
        slug: "atlas",
        workspaceType: "team",
      },
      activeProducts: [],
      capabilities: {
        canInviteMembers: true,
        canManageOrganization: true,
        canSwitchOrganizations: false,
        canUseTeamFeatures: true,
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

    const workspace = await loadAtlasWorkspaceState(auth, headers, sessionWithoutActive);

    expect(workspace.activeOrganization?.id).toBe("org_1");
  });

  it("identifies when a user needs a workspace", async () => {
    const auth = {
      api: {
        listOrganizations: vi.fn().mockResolvedValue([]),
        listUserInvitations: vi.fn().mockResolvedValue([]),
      },
    } as unknown as AuthParam;

    const workspace = await loadAtlasWorkspaceState(auth, headers, session);

    expect(workspace.onboarding.needsWorkspace).toBe(true);
    expect(workspace.activeOrganization).toBeNull();
  });

  it("preserves ISO-string expiration values from Better Auth payloads", async () => {
    const auth = {
      api: {
        listOrganizations: vi.fn().mockResolvedValue([]),
        getActiveMemberRole: vi.fn().mockResolvedValue({ role: "member" }),
        listUserInvitations: vi.fn().mockResolvedValue([
          {
            id: "inv_str",
            email: "operator@atlas.test",
            organizationId: "org_str",
            role: "member",
            status: "pending",
            expiresAt: "2026-06-01T00:00:00.000Z",
          },
        ]),
      },
    } as unknown as AuthParam;

    const workspace = await loadAtlasWorkspaceState(auth, headers, session);

    expect(workspace.pendingInvitations[0]?.expiresAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("treats null expiration values as null and falls back to the default workspace name", async () => {
    const auth = {
      api: {
        listOrganizations: vi.fn().mockResolvedValue([]),
        getActiveMemberRole: vi.fn().mockResolvedValue({ role: "member" }),
        listUserInvitations: vi.fn().mockResolvedValue([
          {
            id: "inv_null",
            email: "operator@atlas.test",
            organizationId: "org_null",
            role: "member",
            status: "pending",
            expiresAt: null,
          },
        ]),
      },
    } as unknown as AuthParam;

    const workspace = await loadAtlasWorkspaceState(auth, headers, session);

    expect(workspace.pendingInvitations[0]?.expiresAt).toBeNull();
    expect(workspace.pendingInvitations[0]?.organizationName).toBe("Atlas Workspace");
    expect(workspace.pendingInvitations[0]?.organizationSlug).toBe("org_null");
  });

  it("ignores non-pending invitations when assembling the workspace state", async () => {
    const auth = {
      api: {
        listOrganizations: vi.fn().mockResolvedValue([]),
        getActiveMemberRole: vi.fn().mockResolvedValue({ role: "member" }),
        listUserInvitations: vi.fn().mockResolvedValue([
          {
            id: "inv_accepted",
            email: "operator@atlas.test",
            organizationId: "org_a",
            role: "member",
            status: "accepted",
          },
          {
            id: "inv_pending",
            email: "operator@atlas.test",
            organizationId: "org_p",
            role: "member",
            status: "pending",
          },
        ]),
      },
    } as unknown as AuthParam;

    const workspace = await loadAtlasWorkspaceState(auth, headers, session);

    expect(workspace.pendingInvitations).toHaveLength(1);
    expect(workspace.pendingInvitations[0]?.id).toBe("inv_pending");
  });

  it("provisions a personal workspace named after the signed-in operator", async () => {
    const createOrganization = vi.fn<CreateOrganization>().mockResolvedValue({
      id: "org_new",
      metadata: { workspaceType: "individual" },
      name: "Operator's Workspace",
      slug: "operator-s-workspace",
    });
    const auth = {
      api: {
        createOrganization,
        getActiveMemberRole: vi.fn().mockResolvedValue({ role: "owner" }),
        listOrganizations: vi.fn().mockResolvedValue([]),
        listUserInvitations: vi.fn().mockResolvedValue([]),
      },
    } as unknown as AuthParam;

    const workspace = await loadAtlasWorkspaceState(auth, headers, session, {
      ensurePersonalWorkspace: true,
    });

    expect(createOrganization).toHaveBeenCalledTimes(1);
    expect(createOrganization.mock.calls[0]?.[0]?.body).toMatchObject({
      keepCurrentActiveOrganization: false,
      name: "Operator's Workspace",
      slug: "operator-s-workspace",
      userId: "user_123",
    });
    expect(workspace.memberships).toEqual([
      {
        id: "org_new",
        name: "Operator's Workspace",
        role: "owner",
        slug: "operator-s-workspace",
        workspaceType: "individual",
      },
    ]);
  });

  it("falls back to the email local part when the account has no display name", async () => {
    const createOrganization = vi.fn<CreateOrganization>().mockResolvedValue({
      id: "org_new",
      metadata: { workspaceType: "individual" },
      name: "My Workspace",
      slug: "operator-s-workspace",
    });
    const auth = {
      api: {
        createOrganization,
        getActiveMemberRole: vi.fn().mockResolvedValue({ role: "owner" }),
        listOrganizations: vi.fn().mockResolvedValue([]),
        listUserInvitations: vi.fn().mockResolvedValue([]),
      },
    } as unknown as AuthParam;

    await loadAtlasWorkspaceState(
      auth,
      headers,
      { ...session, user: { ...session.user, name: "   " } },
      { ensurePersonalWorkspace: true },
    );

    expect(createOrganization.mock.calls[0]?.[0]?.body).toMatchObject({
      name: "My Workspace",
      slug: "operator-s-workspace",
    });
  });

  it("falls back to a generic owner label when neither the name nor the email yields one", async () => {
    const createOrganization = vi.fn<CreateOrganization>().mockResolvedValue({
      id: "org_new",
      metadata: { workspaceType: "individual" },
      name: "My Workspace",
      slug: "my-s-workspace",
    });
    const auth = {
      api: {
        createOrganization,
        getActiveMemberRole: vi.fn().mockResolvedValue({ role: "owner" }),
        listOrganizations: vi.fn().mockResolvedValue([]),
        listUserInvitations: vi.fn().mockResolvedValue([]),
      },
    } as unknown as AuthParam;

    await loadAtlasWorkspaceState(
      auth,
      headers,
      { ...session, user: { ...session.user, email: "@atlas.test", name: "" } },
      { ensurePersonalWorkspace: true },
    );

    expect(createOrganization.mock.calls[0]?.[0]?.body).toMatchObject({
      name: "My Workspace",
      slug: "my-s-workspace",
    });
  });

  it("retries with a suffixed slug when the first choice is already taken", async () => {
    const createOrganization = vi
      .fn<CreateOrganization>()
      .mockRejectedValueOnce(new Error("slug already exists"))
      .mockResolvedValueOnce({
        id: "org_new",
        metadata: { workspaceType: "individual" },
        name: "Operator's Workspace",
        slug: "operator-s-workspace-2",
      });
    const auth = {
      api: {
        createOrganization,
        getActiveMemberRole: vi.fn().mockResolvedValue({ role: "owner" }),
        listOrganizations: vi
          .fn()
          .mockResolvedValue([
            { id: "org_team", metadata: { workspaceType: "team" }, name: "Atlas", slug: "atlas" },
          ]),
        listUserInvitations: vi.fn().mockResolvedValue([]),
      },
    } as unknown as AuthParam;

    const workspace = await loadAtlasWorkspaceState(auth, headers, session, {
      ensurePersonalWorkspace: true,
    });

    expect(createOrganization).toHaveBeenCalledTimes(2);
    expect(createOrganization.mock.calls[0]?.[0]?.body).toMatchObject({
      keepCurrentActiveOrganization: true,
      slug: "operator-s-workspace",
    });
    expect(createOrganization.mock.calls[1]?.[0]?.body).toMatchObject({
      slug: "operator-s-workspace-2",
    });
    expect(workspace.memberships.map((membership) => membership.id)).toEqual([
      "org_team",
      "org_new",
    ]);
  });

  it("surfaces the failure when every slug attempt is rejected", async () => {
    const createOrganization = vi
      .fn<CreateOrganization>()
      .mockRejectedValue(new Error("workspace quota reached"));
    const auth = {
      api: {
        createOrganization,
        getActiveMemberRole: vi.fn().mockResolvedValue({ role: "owner" }),
        listOrganizations: vi.fn().mockResolvedValue([]),
        listUserInvitations: vi.fn().mockResolvedValue([]),
      },
    } as unknown as AuthParam;

    await expect(
      loadAtlasWorkspaceState(auth, headers, session, { ensurePersonalWorkspace: true }),
    ).rejects.toThrow("workspace quota reached");
    expect(createOrganization).toHaveBeenCalledTimes(20);
  });
});
