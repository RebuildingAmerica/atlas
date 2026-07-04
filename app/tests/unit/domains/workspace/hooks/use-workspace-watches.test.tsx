// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceWatchInput } from "@/domains/workspace/server/watches";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  loadWorkspaceWatchStatus: vi.fn(),
  loadWorkspaceWatches: vi.fn(),
  unwatchWorkspaceResource: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  watchWorkspaceResource: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
}));

vi.mock("@/domains/workspace/server/watches", () => ({
  loadWorkspaceWatchStatus: mocks.loadWorkspaceWatchStatus,
  loadWorkspaceWatches: mocks.loadWorkspaceWatches,
  unwatchWorkspaceResource: mocks.unwatchWorkspaceResource,
  watchWorkspaceResource: mocks.watchWorkspaceResource,
}));

describe("workspace watch hooks", () => {
  interface WatchStatusQueryConfig {
    enabled: boolean;
    queryFn(): Promise<unknown>;
    queryKey: readonly unknown[];
  }

  interface WatchListQueryConfig {
    initialData: unknown;
    queryFn(): Promise<unknown>;
    queryKey: readonly unknown[];
  }

  interface WatchMutationConfig {
    mutationFn(data: WorkspaceWatchInput): Promise<unknown>;
    onSuccess?(_data: unknown, variables: WorkspaceWatchInput): Promise<void> | void;
  }

  beforeEach(() => {
    vi.resetModules();
    mocks.invalidateQueries.mockReset();
    mocks.loadWorkspaceWatchStatus.mockReset();
    mocks.loadWorkspaceWatches.mockReset();
    mocks.unwatchWorkspaceResource.mockReset();
    mocks.useMutation.mockReset();
    mocks.useQuery.mockReset();
    mocks.useQueryClient.mockReset();
    mocks.watchWorkspaceResource.mockReset();
    mocks.useQuery.mockReturnValue({ data: null });
    mocks.useQueryClient.mockReturnValue({ invalidateQueries: mocks.invalidateQueries });
    mocks.useMutation.mockImplementation((config: WatchMutationConfig) => config);
  });

  function queryConfig(): WatchStatusQueryConfig {
    const call = mocks.useQuery.mock.calls.at(0) as [unknown] | undefined;
    if (!call) {
      throw new TypeError("Expected useQuery to receive a config object.");
    }
    return call[0] as WatchStatusQueryConfig;
  }

  function watchListQueryConfig(): WatchListQueryConfig {
    const call = mocks.useQuery.mock.calls.at(0) as [unknown] | undefined;
    if (!call) {
      throw new TypeError("Expected useQuery to receive a config object.");
    }
    return call[0] as WatchListQueryConfig;
  }

  function mutationConfig(): WatchMutationConfig {
    const call = mocks.useMutation.mock.calls.at(0) as [unknown] | undefined;
    if (!call) {
      throw new TypeError("Expected useMutation to receive a config object.");
    }
    return call[0] as WatchMutationConfig;
  }

  it("loads watch status for one resource", async () => {
    const mod = await import("@/domains/workspace/hooks/use-workspace-watches");
    renderHook(() =>
      mod.useWorkspaceWatchStatus({
        resourceId: "coverage_123",
        resourceType: "coverage_target",
      }),
    );

    const config = queryConfig();
    expect(config.queryKey).toEqual(["workspace", "watches", "coverage_target", "coverage_123"]);
    expect(config.enabled).toBe(true);
    await config.queryFn();
    expect(mocks.loadWorkspaceWatchStatus).toHaveBeenCalledWith({
      data: {
        resourceId: "coverage_123",
        resourceType: "coverage_target",
      },
    });
  });

  it("hydrates the shared workspace watch list", async () => {
    const collection = { items: [], total: 0 };
    const mod = await import("@/domains/workspace/hooks/use-workspace-watches");
    renderHook(() => mod.useWorkspaceWatches(collection));

    const config = watchListQueryConfig();
    expect(config.queryKey).toEqual(["workspace", "watches"]);
    expect(config.initialData).toBe(collection);
    await config.queryFn();
    expect(mocks.loadWorkspaceWatches).toHaveBeenCalledWith();
  });

  it("watches and refreshes a resource status", async () => {
    const input: WorkspaceWatchInput = {
      resourceId: "coverage_123",
      resourceType: "coverage_target",
    };
    const mod = await import("@/domains/workspace/hooks/use-workspace-watches");
    renderHook(() => mod.useWatchWorkspaceResource());

    const config = mutationConfig();
    await config.mutationFn(input);
    await config.onSuccess?.({}, input);

    expect(mocks.watchWorkspaceResource).toHaveBeenCalledWith({ data: input });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["workspace", "watches", "coverage_target", "coverage_123"],
    });
  });

  it("unwatches and refreshes a resource status", async () => {
    const input: WorkspaceWatchInput = {
      resourceId: "entry_123",
      resourceType: "entry",
    };
    const mod = await import("@/domains/workspace/hooks/use-workspace-watches");
    renderHook(() => mod.useUnwatchWorkspaceResource());

    const config = mutationConfig();
    await config.mutationFn(input);
    await config.onSuccess?.({}, input);

    expect(mocks.unwatchWorkspaceResource).toHaveBeenCalledWith({ data: input });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["workspace", "watches", "entry", "entry_123"],
    });
  });
});
