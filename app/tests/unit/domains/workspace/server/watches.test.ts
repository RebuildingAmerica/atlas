import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceWatchInput } from "@/domains/workspace/server/watches";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
  requireReadyAtlasSessionState: vi.fn(),
}));

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
            {
              created_at: "2026-06-25T00:00:00Z",
              created_by: "user_1",
              id: "watch_entry",
              notification_preference: "digest",
              org_id: "org_123",
              resource_id: "entry_123",
              resource_type: "entry",
              updated_at: "2026-06-26T00:00:00Z",
            },
            {
              created_at: "2026-06-25T00:00:00Z",
              created_by: "user_1",
              id: "watch_coverage",
              notification_preference: "muted",
              org_id: "org_123",
              resource_id: "coverage_123",
              resource_type: "coverage_target",
              updated_at: "2026-06-25T00:00:00Z",
            },
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
});
