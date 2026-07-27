import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdapterCreate,
  AdapterFindOne,
  AdapterUpdate,
  EnsureAuthReady,
  GrantWorkspaceProduct,
  UserLookup,
  UserUpdate,
} from "../../../../helpers/demo-workspace-provisioning-mocks";

const mocks = vi.hoisted(() => ({
  adapterCreate: vi.fn<AdapterCreate>(),
  adapterFindOne: vi.fn<AdapterFindOne>(),
  adapterUpdate: vi.fn<AdapterUpdate>(),
  createUser: vi.fn<UserLookup>(),
  ensureAuthReady: vi.fn<EnsureAuthReady>(),
  findUserByEmail: vi.fn<UserLookup>(),
  findUserById: vi.fn<UserLookup>(),
  grantWorkspaceProduct: vi.fn<GrantWorkspaceProduct>(),
  updateUser: vi.fn<UserUpdate>(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));
vi.mock("@/domains/access/server/workspace-products", () => ({
  grantWorkspaceProduct: mocks.grantWorkspaceProduct,
}));

describe("demo workspace provisioning", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));
    mocks.adapterCreate.mockReset();
    mocks.adapterFindOne.mockReset();
    mocks.adapterUpdate.mockReset();
    mocks.createUser.mockReset();
    mocks.ensureAuthReady.mockReset();
    mocks.findUserByEmail.mockReset();
    mocks.findUserById.mockReset();
    mocks.grantWorkspaceProduct.mockReset();
    mocks.updateUser.mockReset();

    mocks.ensureAuthReady.mockResolvedValue({
      $context: Promise.resolve({
        adapter: {
          create: mocks.adapterCreate,
          findOne: mocks.adapterFindOne,
          update: mocks.adapterUpdate,
        },
        internalAdapter: {
          createUser: mocks.createUser,
          findUserByEmail: mocks.findUserByEmail,
          findUserById: mocks.findUserById,
          updateUser: mocks.updateUser,
        },
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a verified user, team workspace, owner membership, and active product", async () => {
    mocks.findUserById.mockResolvedValue(null);
    mocks.findUserByEmail.mockResolvedValue(null);
    mocks.adapterFindOne.mockResolvedValue(null);

    const { provisionBriefingRoomDemoWorkspace } =
      await import("@/domains/access/server/demo-workspace-provisioning");
    const result = await provisionBriefingRoomDemoWorkspace({
      organizationId: "briefing-room-demo",
      organizationName: "Atlas Briefing Room Demo",
      organizationSlug: "briefing-room-demo",
      userEmail: "demo@atlas.test",
      userId: "briefing-room-operator",
      userName: "Briefing Room Operator",
    });

    expect(result).toEqual({
      organizationId: "briefing-room-demo",
      product: "atlas_team",
      userId: "briefing-room-operator",
    });
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: "demo@atlas.test",
      emailVerified: true,
      id: "briefing-room-operator",
      image: null,
      name: "Briefing Room Operator",
    });
    expect(mocks.adapterCreate).toHaveBeenCalledWith({
      forceAllowId: true,
      model: "organization",
      data: {
        createdAt: new Date("2026-07-03T12:00:00.000Z"),
        id: "briefing-room-demo",
        logo: null,
        metadata: JSON.stringify({
          onboarding: {
            demoDataSeed: "briefing_room",
            firstSavedViews: [
              "Detroit mutual aid follow-up",
              "Atlanta housing follow-up",
              "Milwaukee democracy follow-up",
            ],
            product: "atlas_team",
            provisionedAt: "2026-07-03T12:00:00.000Z",
          },
          workspaceType: "team",
        }),
        name: "Atlas Briefing Room Demo",
        slug: "briefing-room-demo",
      },
    });
    expect(mocks.adapterCreate).toHaveBeenCalledWith({
      forceAllowId: true,
      model: "member",
      data: {
        createdAt: new Date("2026-07-03T12:00:00.000Z"),
        id: "member_briefing-room-demo_briefing-room-operator",
        organizationId: "briefing-room-demo",
        role: "owner",
        userId: "briefing-room-operator",
      },
    });
    expect(mocks.grantWorkspaceProduct).toHaveBeenCalledWith({
      product: "atlas_team",
      workspaceId: "briefing-room-demo",
    });
  });

  it("provisions a customer workspace with package, demo data, and first saved views", async () => {
    mocks.findUserById.mockResolvedValue(null);
    mocks.findUserByEmail.mockResolvedValue(null);
    mocks.adapterFindOne.mockResolvedValue(null);

    const { provisionCustomerWorkspace } =
      await import("@/domains/access/server/demo-workspace-provisioning");
    const result = await provisionCustomerWorkspace({
      demoDataSeed: "briefing_room",
      firstSavedViews: [
        "Detroit mutual aid follow-up",
        "Atlanta housing follow-up",
        "Milwaukee democracy follow-up",
      ],
      organizationId: "first-customer-demo",
      organizationName: "First Customer Demo",
      organizationSlug: "first-customer-demo",
      product: "atlas_team",
      userEmail: "Director@Example.Org",
      userId: "customer-operator",
      userName: "Customer Operator",
    });

    expect(result).toEqual({
      demoDataSeed: "briefing_room",
      firstSavedViews: [
        "Detroit mutual aid follow-up",
        "Atlanta housing follow-up",
        "Milwaukee democracy follow-up",
      ],
      organizationId: "first-customer-demo",
      product: "atlas_team",
      seedCommand:
        "uv --directory ./api run python -m atlas.seed_briefing_room_demo --org-id first-customer-demo --user-id customer-operator",
      userId: "customer-operator",
    });
    expect(mocks.adapterCreate).toHaveBeenCalledWith({
      forceAllowId: true,
      model: "organization",
      data: {
        createdAt: new Date("2026-07-03T12:00:00.000Z"),
        id: "first-customer-demo",
        logo: null,
        metadata: JSON.stringify({
          onboarding: {
            demoDataSeed: "briefing_room",
            firstSavedViews: [
              "Detroit mutual aid follow-up",
              "Atlanta housing follow-up",
              "Milwaukee democracy follow-up",
            ],
            product: "atlas_team",
            provisionedAt: "2026-07-03T12:00:00.000Z",
          },
          workspaceType: "team",
        }),
        name: "First Customer Demo",
        slug: "first-customer-demo",
      },
    });
    expect(mocks.grantWorkspaceProduct).toHaveBeenCalledWith({
      product: "atlas_team",
      workspaceId: "first-customer-demo",
    });
  });

  it("updates existing demo workspace records idempotently", async () => {
    mocks.findUserById.mockResolvedValue({ id: "briefing-room-operator" });
    mocks.adapterFindOne
      .mockResolvedValueOnce({ id: "briefing-room-demo" })
      .mockResolvedValueOnce({ id: "member_1" });

    const { provisionBriefingRoomDemoWorkspace } =
      await import("@/domains/access/server/demo-workspace-provisioning");
    await provisionBriefingRoomDemoWorkspace({
      organizationId: "briefing-room-demo",
      organizationName: "Atlas Briefing Room Demo",
      organizationSlug: "briefing-room-demo",
      userEmail: "demo@atlas.test",
      userId: "briefing-room-operator",
      userName: "Briefing Room Operator",
    });

    expect(mocks.updateUser).toHaveBeenCalledWith("briefing-room-operator", {
      email: "demo@atlas.test",
      emailVerified: true,
      name: "Briefing Room Operator",
    });
    expect(mocks.adapterUpdate).toHaveBeenCalledWith({
      model: "organization",
      update: {
        logo: null,
        metadata: JSON.stringify({
          onboarding: {
            demoDataSeed: "briefing_room",
            firstSavedViews: [
              "Detroit mutual aid follow-up",
              "Atlanta housing follow-up",
              "Milwaukee democracy follow-up",
            ],
            product: "atlas_team",
            provisionedAt: "2026-07-03T12:00:00.000Z",
          },
          workspaceType: "team",
        }),
        name: "Atlas Briefing Room Demo",
        slug: "briefing-room-demo",
      },
      where: [{ field: "id", value: "briefing-room-demo" }],
    });
    expect(mocks.adapterUpdate).toHaveBeenCalledWith({
      model: "member",
      update: { role: "owner" },
      where: [{ field: "id", value: "member_1" }],
    });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("preserves existing organization metadata when refreshing provisioning metadata", async () => {
    mocks.findUserById.mockResolvedValue({ id: "customer-operator" });
    mocks.adapterFindOne
      .mockResolvedValueOnce({
        id: "first-customer-demo",
        metadata: JSON.stringify({
          ssoPrimaryProviderId: "sso_provider_123",
          stripeCustomerId: "cus_123",
          workspaceDomain: "example.org",
          workspaceType: "team",
          publicDirectoryDraftId: "directory_draft_123",
        }),
      })
      .mockResolvedValueOnce({ id: "member_1" });

    const { provisionCustomerWorkspace } =
      await import("@/domains/access/server/demo-workspace-provisioning");
    await provisionCustomerWorkspace({
      demoDataSeed: "briefing_room",
      firstSavedViews: ["Detroit mutual aid follow-up"],
      organizationId: "first-customer-demo",
      organizationName: "First Customer Demo",
      organizationSlug: "first-customer-demo",
      product: "atlas_team",
      userEmail: "Director@Example.Org",
      userId: "customer-operator",
      userName: "Customer Operator",
    });

    const organizationUpdate = mocks.adapterUpdate.mock.calls.find(
      ([call]) => call.model === "organization",
    )?.[0];
    expect(organizationUpdate).toMatchObject({
      model: "organization",
      update: {
        logo: null,
        name: "First Customer Demo",
        slug: "first-customer-demo",
      },
      where: [{ field: "id", value: "first-customer-demo" }],
    });
    const metadata = organizationUpdate?.update.metadata;
    expect(typeof metadata).toBe("string");
    if (typeof metadata !== "string") {
      throw new Error("Organization update did not include serialized metadata.");
    }
    expect(JSON.parse(metadata)).toMatchObject({
      onboarding: {
        demoDataSeed: "briefing_room",
        firstSavedViews: ["Detroit mutual aid follow-up"],
        product: "atlas_team",
        provisionedAt: "2026-07-03T12:00:00.000Z",
      },
      publicDirectoryDraftId: "directory_draft_123",
      ssoPrimaryProviderId: "sso_provider_123",
      stripeCustomerId: "cus_123",
      workspaceDomain: "example.org",
      workspaceType: "team",
    });
  });

  it("rejects unsafe seed command identifiers before provisioning records", async () => {
    const { provisionCustomerWorkspace } =
      await import("@/domains/access/server/demo-workspace-provisioning");

    await expect(
      provisionCustomerWorkspace({
        demoDataSeed: "briefing_room",
        firstSavedViews: ["Detroit mutual aid follow-up"],
        organizationId: "org;rm",
        organizationName: "Unsafe Workspace",
        organizationSlug: "unsafe-workspace",
        product: "atlas_team",
        userEmail: "operator@example.org",
        userId: "customer-operator",
        userName: "Customer Operator",
      }),
    ).rejects.toThrow(
      "Organization id may only contain letters, numbers, underscores, and hyphens.",
    );
    expect(mocks.ensureAuthReady).not.toHaveBeenCalled();
    expect(mocks.adapterCreate).not.toHaveBeenCalled();
  });

  it("rejects reusing an email that belongs to a different user id", async () => {
    mocks.findUserById.mockResolvedValue(null);
    mocks.findUserByEmail.mockResolvedValue({ user: { id: "other-user" }, accounts: [] });

    const { provisionBriefingRoomDemoWorkspace } =
      await import("@/domains/access/server/demo-workspace-provisioning");

    await expect(
      provisionBriefingRoomDemoWorkspace({
        organizationId: "briefing-room-demo",
        organizationName: "Atlas Briefing Room Demo",
        organizationSlug: "briefing-room-demo",
        userEmail: "demo@atlas.test",
        userId: "briefing-room-operator",
        userName: "Briefing Room Operator",
      }),
    ).rejects.toThrow("Demo email already belongs to another Atlas user.");
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("re-verifies an operator who already owns that email instead of creating a duplicate", async () => {
    mocks.findUserById.mockResolvedValue(null);
    mocks.findUserByEmail.mockResolvedValue({
      accounts: [],
      user: { id: "briefing-room-operator" },
    });

    const { provisionBriefingRoomDemoWorkspace } =
      await import("@/domains/access/server/demo-workspace-provisioning");

    await provisionBriefingRoomDemoWorkspace({
      organizationId: "briefing-room-demo",
      organizationName: "Atlas Briefing Room Demo",
      organizationSlug: "briefing-room-demo",
      userEmail: "Demo@Atlas.test",
      userId: "briefing-room-operator",
      userName: "Briefing Room Operator",
    });

    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.updateUser).toHaveBeenCalledWith("briefing-room-operator", {
      email: "demo@atlas.test",
      emailVerified: true,
      name: "Briefing Room Operator",
    });
  });

  it("refuses to guess a member id when the adapter returns an unexpected shape", async () => {
    mocks.adapterFindOne.mockResolvedValue({ role: "member" });

    const { provisionBriefingRoomDemoWorkspace } =
      await import("@/domains/access/server/demo-workspace-provisioning");

    await expect(
      provisionBriefingRoomDemoWorkspace({
        organizationId: "briefing-room-demo",
        organizationName: "Atlas Briefing Room Demo",
        organizationSlug: "briefing-room-demo",
        userEmail: "demo@atlas.test",
        userId: "briefing-room-operator",
        userName: "Briefing Room Operator",
      }),
    ).rejects.toThrow("Demo member lookup did not return a member id.");
  });

  it("omits the seed command for a workspace provisioned without demo data", async () => {
    const { provisionCustomerWorkspace } =
      await import("@/domains/access/server/demo-workspace-provisioning");

    const result = await provisionCustomerWorkspace({
      demoDataSeed: "none",
      firstSavedViews: ["Housing"],
      organizationId: "customer-org",
      organizationName: "Customer",
      organizationSlug: "customer",
      product: "atlas_team",
      userEmail: "operator@customer.test",
      userId: "customer-operator",
      userName: "Customer Operator",
    });

    expect(result.seedCommand).toBeNull();
    expect(result.firstSavedViews).toEqual(["Housing"]);
  });
});
