// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadWorkspaceWatchDigest: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@/domains/workspace/server/watch-digest", () => ({
  loadWorkspaceWatchDigest: mocks.loadWorkspaceWatchDigest,
}));

describe("workspace watch digest hooks", () => {
  interface WatchDigestQueryConfig {
    queryFn(): Promise<unknown>;
    queryKey: readonly unknown[];
  }

  beforeEach(() => {
    vi.resetModules();
    mocks.loadWorkspaceWatchDigest.mockReset();
    mocks.useQuery.mockReset();
    mocks.useQuery.mockReturnValue({ data: null });
  });

  function queryConfig(): WatchDigestQueryConfig {
    const call = mocks.useQuery.mock.calls.at(0) as [unknown] | undefined;
    if (!call) {
      throw new TypeError("Expected useQuery to receive a config object.");
    }

    return call[0] as WatchDigestQueryConfig;
  }

  it("loads workspace watch digest rows with a stable query key", async () => {
    const mod = await import("@/domains/workspace/hooks/use-workspace-watch-digest");
    renderHook(() => mod.useWorkspaceWatchDigest(25));

    const config = queryConfig();
    expect(config.queryKey).toEqual(["workspace", "watch-digest", 25]);
    await config.queryFn();
    expect(mocks.loadWorkspaceWatchDigest).toHaveBeenCalledWith({ data: { limit: 25 } });
  });
});
