import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceWatch,
  WorkspaceWatchCollection,
  WorkspaceWatchInput,
  WorkspaceWatchStatus,
} from "@/domains/workspace/server/watches";
import type { ServerFnExecutionResponse } from "../../../../helpers/server-fn-stub";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
  requireReadyAtlasSessionState: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/access/server/session-state", () => ({
  requireReadyAtlasSessionState: mocks.requireReadyAtlasSessionState,
}));

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("workspace watches server helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
  });

  function activeWorkspace() {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
  }

  function watchRow(overrides: Partial<WorkspaceWatch>): WorkspaceWatch {
    return {
      created_at: "2026-06-25T00:00:00Z",
      created_by: "user_1",
      id: `watch_${String(overrides.resource_id)}`,
      notification_preference: "digest",
      org_id: "org_123",
      resource_id: "entry_1",
      resource_type: "entry",
      updated_at: "2026-06-26T00:00:00Z",
      ...overrides,
    };
  }

  it("loads watch status for the active workspace", async () => {
    const status = { watched: false, watch: null };
    activeWorkspace();
    mocks.requestAtlasApi.mockResolvedValue(status);

    const { loadWorkspaceWatchStatusData } = await import("@/domains/workspace/server/watches");
    const result = await loadWorkspaceWatchStatusData({
      resourceId: "coverage_123",
      resourceType: "coverage_target",
    });

    expect(result).toBe(status);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/orgs/org_123/watches/coverage_target/coverage_123",
    );
  });

  it("loads workspace watches with readable entry and coverage target context", async () => {
    activeWorkspace();
    mocks.requestAtlasApi.mockImplementation((path: string): unknown => {
      if (path === "/orgs/org_123/watches") {
        return {
          items: [
            watchRow({ resource_id: "entry_123", resource_type: "entry" }),
            watchRow({
              notification_preference: "muted",
              resource_id: "coverage_123",
              resource_type: "coverage_target",
            }),
          ],
          total: 2,
        };
      }
      if (path === "/entities/entry_123") {
        return {
          address: { city: "Kansas City", state: "MO" },
          id: "entry_123",
          name: "KC Tenants",
          slug: "kc-tenants",
          type: "organization",
        };
      }
      if (path === "/orgs/org_123/coverage-targets/coverage_123") {
        return {
          entries: [],
          discovery_runs: [],
          target: {
            geography: "Kansas City, MO",
            id: "coverage_123",
            name: "Kansas City tenant power",
            status: "thin",
          },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const { loadWorkspaceWatchesData } = await import("@/domains/workspace/server/watches");
    const result = await loadWorkspaceWatchesData();

    expect(result.orgId).toBe("org_123");
    expect(result.total).toBe(2);
    expect(result.items).toEqual([
      expect.objectContaining({
        href: "/profiles/organizations/kc-tenants",
        label: "KC Tenants",
        location: "Kansas City, MO",
        resourceLabel: "Organization",
      }),
      expect.objectContaining({
        href: "/coverage/coverage_123",
        label: "Kansas City tenant power",
        location: "Kansas City, MO",
        resourceLabel: "Coverage target",
        status: "thin",
      }),
    ]);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/watches");
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/entities/entry_123");
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/orgs/org_123/coverage-targets/coverage_123",
    );
  });

  it("routes each actor kind to its own profile address and label", async () => {
    activeWorkspace();
    const entries: Record<string, unknown> = {
      entry_person: {
        address: { display: "Denver, CO" },
        id: "entry_person",
        name: "Ada Ruiz",
        slug: "ada-ruiz",
        type: "person",
      },
      entry_initiative: {
        address: {},
        id: "entry_initiative",
        name: "Front Porch Repair",
        slug: "front-porch-repair",
        type: "initiative",
      },
      entry_campaign: {
        address: { city: "Tulsa" },
        id: "entry_campaign",
        name: "Rent Relief Now",
        slug: "rent-relief-now",
        type: "campaign",
      },
      entry_event: {
        address: { state: "OK" },
        id: "entry_event",
        name: "Tenant Summit",
        slug: "tenant-summit",
        type: "event",
      },
      entry_coalition: {
        address: {},
        id: "entry_coalition",
        name: "Housing Coalition",
        slug: "housing-coalition",
        type: "coalition",
      },
      entry_unslugged: {
        address: {},
        id: "entry_unslugged",
        name: "Unpublished Actor",
        slug: null,
        type: "person",
      },
    };
    mocks.requestAtlasApi.mockImplementation((path: string): unknown => {
      if (path === "/orgs/org_123/watches") {
        return {
          items: Object.keys(entries).map((resourceId) => watchRow({ resource_id: resourceId })),
          total: 6,
        };
      }
      const entry = entries[path.replace("/entities/", "")];
      if (!entry) {
        throw new Error(`Unexpected path: ${path}`);
      }
      return entry;
    });

    const { loadWorkspaceWatchesData } = await import("@/domains/workspace/server/watches");
    const result = await loadWorkspaceWatchesData();

    expect(
      result.items.map((item) => ({
        href: item.href,
        location: item.location,
        resourceLabel: item.resourceLabel,
      })),
    ).toEqual([
      {
        href: "/profiles/people/ada-ruiz",
        location: "Denver, CO",
        resourceLabel: "Person",
      },
      {
        href: "/profiles/initiatives/front-porch-repair",
        location: undefined,
        resourceLabel: "Initiative",
      },
      {
        href: "/profiles/campaigns/rent-relief-now",
        location: "Tulsa",
        resourceLabel: "Campaign",
      },
      {
        href: "/profiles/events/tenant-summit",
        location: "OK",
        resourceLabel: "Event",
      },
      {
        href: null,
        location: undefined,
        resourceLabel: "Actor",
      },
      {
        href: null,
        location: undefined,
        resourceLabel: "Person",
      },
    ]);
  });

  it("watches a workspace resource with an explicit notification preference", async () => {
    const input: WorkspaceWatchInput = {
      notificationPreference: "immediate",
      resourceId: "coverage_123",
      resourceType: "coverage_target",
    };
    const watch = { id: "watch_123", resource_id: "coverage_123" };
    activeWorkspace();
    mocks.requestAtlasApi.mockResolvedValue(watch);

    const { watchWorkspaceResourceData } = await import("@/domains/workspace/server/watches");
    const result = await watchWorkspaceResourceData(input);

    expect(result).toBe(watch);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/orgs/org_123/watches/coverage_target/coverage_123",
      {
        body: JSON.stringify({ notification_preference: "immediate" }),
        method: "PUT",
      },
    );
  });

  it("sends a null body when the caller keeps the workspace default preference", async () => {
    activeWorkspace();
    mocks.requestAtlasApi.mockResolvedValue({ id: "watch_123" });

    const { watchWorkspaceResourceData } = await import("@/domains/workspace/server/watches");
    await watchWorkspaceResourceData({
      resourceId: "entry_123",
      resourceType: "entry",
    });

    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/watches/entry/entry_123", {
      body: "null",
      method: "PUT",
    });
  });

  it("unwatches a workspace resource", async () => {
    activeWorkspace();
    mocks.requestAtlasApi.mockResolvedValue(undefined);

    const { unwatchWorkspaceResourceData } = await import("@/domains/workspace/server/watches");
    await unwatchWorkspaceResourceData({
      resourceId: "entry_123",
      resourceType: "entry",
    });

    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/watches/entry/entry_123", {
      method: "DELETE",
    });
  });

  it("refuses every watch call when no workspace is open", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: { activeOrganization: null },
    });

    const watches = await import("@/domains/workspace/server/watches");
    const input: WorkspaceWatchInput = { resourceId: "entry_1", resourceType: "entry" };

    await expect(watches.loadWorkspaceWatchStatusData(input)).rejects.toThrow(
      "Open a workspace before loading workspace watches.",
    );
    await expect(watches.loadWorkspaceWatchesData()).rejects.toThrow(
      "Open a workspace before loading workspace watches.",
    );
    await expect(watches.watchWorkspaceResourceData(input)).rejects.toThrow(
      "Open a workspace before loading workspace watches.",
    );
    await expect(watches.unwatchWorkspaceResourceData(input)).rejects.toThrow(
      "Open a workspace before loading workspace watches.",
    );
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });
});

describe("workspace watches server functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: { activeOrganization: { id: "org_123" } },
    });
  });

  it("returns watch status through the GET server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ watched: true, watch: { id: "watch_1" } });

    const { loadWorkspaceWatchStatus } = await import("@/domains/workspace/server/watches");
    const response = (await loadWorkspaceWatchStatus.__executeServer({
      data: { resourceId: "entry_1", resourceType: "entry" },
      method: "GET",
    })) as ServerFnExecutionResponse<WorkspaceWatchStatus>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ watched: true, watch: { id: "watch_1" } });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/watches/entry/entry_1");
  });

  it("rejects a watch-status request for an unsupported resource type", async () => {
    const { loadWorkspaceWatchStatus } = await import("@/domains/workspace/server/watches");
    const response = (await loadWorkspaceWatchStatus.__executeServer({
      data: { resourceId: "entry_1", resourceType: "list" },
      method: "GET",
    })) as ServerFnExecutionResponse<WorkspaceWatchStatus>;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });

  it("returns the enriched watch collection through the GET server function", async () => {
    mocks.requestAtlasApi.mockImplementation((path: string): unknown => {
      if (path === "/orgs/org_123/watches") {
        return {
          items: [
            {
              created_at: "2026-06-25T00:00:00Z",
              created_by: "user_1",
              id: "watch_1",
              notification_preference: "digest",
              org_id: "org_123",
              resource_id: "entry_1",
              resource_type: "entry",
              updated_at: "2026-06-25T00:00:00Z",
            },
          ],
          total: 1,
        };
      }
      return {
        address: { display: "Boise, ID" },
        id: "entry_1",
        name: "Idaho Housing Table",
        slug: "idaho-housing-table",
        type: "organization",
      };
    });

    const { loadWorkspaceWatches } = await import("@/domains/workspace/server/watches");
    const response = (await loadWorkspaceWatches.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse<WorkspaceWatchCollection>;

    expect(response.error).toBeUndefined();
    expect(response.result?.items).toEqual([
      expect.objectContaining({
        href: "/profiles/organizations/idaho-housing-table",
        label: "Idaho Housing Table",
        location: "Boise, ID",
      }),
    ]);
  });

  it("creates a watch through the POST server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ id: "watch_1", resource_id: "coverage_1" });

    const { watchWorkspaceResource } = await import("@/domains/workspace/server/watches");
    const response = (await watchWorkspaceResource.__executeServer({
      data: {
        notificationPreference: "digest",
        resourceId: "coverage_1",
        resourceType: "coverage_target",
      },
      method: "POST",
    })) as ServerFnExecutionResponse<WorkspaceWatch>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ id: "watch_1", resource_id: "coverage_1" });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/orgs/org_123/watches/coverage_target/coverage_1",
      { body: JSON.stringify({ notification_preference: "digest" }), method: "PUT" },
    );
  });

  it("removes a watch through the POST server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue(undefined);

    const { unwatchWorkspaceResource } = await import("@/domains/workspace/server/watches");
    const response = (await unwatchWorkspaceResource.__executeServer({
      data: { resourceId: "entry_1", resourceType: "entry" },
      method: "POST",
    })) as ServerFnExecutionResponse<void>;

    expect(response.error).toBeUndefined();
    expect(response.result).toBeUndefined();
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/watches/entry/entry_1", {
      method: "DELETE",
    });
  });
});
