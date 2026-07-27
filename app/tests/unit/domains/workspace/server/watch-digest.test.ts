import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("workspace watch digest server function", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: { activeOrganization: { id: "org_123" } },
    });
  });

  it("asks for fifty digest events when the route names no limit", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [], total: 0 });

    const { loadWorkspaceWatchDigest } = await import("@/domains/workspace/server/watch-digest");
    const response = (await loadWorkspaceWatchDigest.__executeServer({
      data: {},
      method: "GET",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ items: [], total: 0 });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(expect.stringContaining("limit=50"));
  });

  it("rejects a digest limit beyond the supported page size", async () => {
    const { loadWorkspaceWatchDigest } = await import("@/domains/workspace/server/watch-digest");
    const response = (await loadWorkspaceWatchDigest.__executeServer({
      data: { limit: 5000 },
      method: "GET",
    })) as ServerFnExecutionResponse;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });
});
