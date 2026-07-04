import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("workspace watch digest server loader", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
  });

  it("loads the watch digest for the active workspace", async () => {
    const digest = {
      coverage_signal_count: 0,
      items: [],
      source_signal_count: 0,
      total: 0,
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(digest);

    const { loadWorkspaceWatchDigestData } =
      await import("@/domains/workspace/server/watch-digest");
    const result = await loadWorkspaceWatchDigestData(25);

    expect(result).toBe(digest);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/watch-digest?limit=25");
  });

  it("fails before fetching when there is no active workspace", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: null,
      },
    });

    const { loadWorkspaceWatchDigestData } =
      await import("@/domains/workspace/server/watch-digest");

    await expect(loadWorkspaceWatchDigestData()).rejects.toThrow(
      "Open a workspace before loading watch digest.",
    );
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });
});
