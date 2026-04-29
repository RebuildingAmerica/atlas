// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getDiscoveryRun: vi.fn(),
  invalidateQueries: vi.fn(),
  listDiscoveryRuns: vi.fn(),
  startDiscoveryRun: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
}));

vi.mock("@/domains/discovery/functions", () => ({
  getDiscoveryRun: mocks.getDiscoveryRun,
  listDiscoveryRuns: mocks.listDiscoveryRuns,
  startDiscoveryRun: mocks.startDiscoveryRun,
}));

describe("discovery hooks", () => {
  interface DiscoveryListQueryConfig {
    queryFn(): Promise<unknown>;
    queryKey: string[];
    refetchInterval(query: {
      state: { data?: { items?: { status: string }[] }; dataUpdatedAt: number };
    }): false | number;
  }

  interface DiscoveryRunQueryConfig {
    queryFn(): Promise<unknown>;
    queryKey: string[];
    refetchInterval(query: {
      state: { data?: { status?: string }; dataUpdatedAt: number };
    }): false | number;
  }

  interface StartDiscoveryMutationConfig {
    mutationFn(data: {
      issue_areas: string[];
      location_query: string;
      state: string;
    }): Promise<unknown>;
    onSuccess?(): Promise<void> | void;
  }

  beforeEach(() => {
    vi.resetModules();
    mocks.getDiscoveryRun.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.listDiscoveryRuns.mockReset();
    mocks.startDiscoveryRun.mockReset();
    mocks.useMutation.mockReset();
    mocks.useQuery.mockReset();
    mocks.useQueryClient.mockReset();
    mocks.useQuery.mockReturnValue({ data: null });
    mocks.useQueryClient.mockReturnValue({
      invalidateQueries: mocks.invalidateQueries,
    });
    mocks.useMutation.mockImplementation((config: StartDiscoveryMutationConfig) => config);
  });

  function getUseQueryConfig(index: number): DiscoveryListQueryConfig | DiscoveryRunQueryConfig {
    const call = mocks.useQuery.mock.calls.at(index) as [unknown] | undefined;
    const config = call?.[0];

    if (!config) {
      throw new TypeError("Expected useQuery to receive a config object.");
    }

    return config as DiscoveryListQueryConfig | DiscoveryRunQueryConfig;
  }

  function getUseMutationConfig(): StartDiscoveryMutationConfig {
    const call = mocks.useMutation.mock.calls.at(0) as [unknown] | undefined;
    const config = call?.[0];

    if (!config) {
      throw new TypeError("Expected useMutation to receive a config object.");
    }

    return config as StartDiscoveryMutationConfig;
  }

  it("configures discovery run list polling intervals", async () => {
    const mod = await import("@/domains/discovery/hooks/use-discovery");
    renderHook(() => mod.useDiscoveryRuns());

    const typedConfig = getUseQueryConfig(0) as DiscoveryListQueryConfig;
    expect(typedConfig.queryKey).toEqual(["discovery", "runs"]);
    await typedConfig.queryFn();
    expect(mocks.listDiscoveryRuns).toHaveBeenCalledTimes(1);
    expect(
      typedConfig.refetchInterval({
        state: { data: { items: [{ status: "running" }] }, dataUpdatedAt: Date.now() },
      }),
    ).toBe(3_000);
    expect(typedConfig.refetchInterval({ state: { data: undefined, dataUpdatedAt: 0 } })).toBe(
      false,
    );
    expect(
      typedConfig.refetchInterval({
        state: {
          data: { items: [{ status: "running" }] },
          dataUpdatedAt: Date.now() - 61_000,
        },
      }),
    ).toBe(10_000);
    expect(
      typedConfig.refetchInterval({
        state: { data: { items: [{ status: "completed" }] }, dataUpdatedAt: 0 },
      }),
    ).toBe(false);
  });

  it("configures single-run polling intervals and keyed fetching", async () => {
    const mod = await import("@/domains/discovery/hooks/use-discovery");
    renderHook(() => mod.useDiscoveryRun("run_123"));

    const typedConfig = getUseQueryConfig(0) as DiscoveryRunQueryConfig;
    expect(typedConfig.queryKey).toEqual(["discovery", "runs", "run_123"]);
    await typedConfig.queryFn();
    expect(mocks.getDiscoveryRun).toHaveBeenCalledWith({ data: { id: "run_123" } });
    expect(
      typedConfig.refetchInterval({
        state: { data: { status: "running" }, dataUpdatedAt: Date.now() },
      }),
    ).toBe(3_000);
    expect(
      typedConfig.refetchInterval({ state: { data: undefined, dataUpdatedAt: Date.now() } }),
    ).toBe(3_000);
    expect(
      typedConfig.refetchInterval({
        state: { data: undefined, dataUpdatedAt: Date.now() - 61_000 },
      }),
    ).toBe(10_000);
    expect(
      typedConfig.refetchInterval({ state: { data: { status: "failed" }, dataUpdatedAt: 0 } }),
    ).toBe(false);
  });

  it("invalidates discovery runs after a successful start mutation", async () => {
    const mod = await import("@/domains/discovery/hooks/use-discovery");
    renderHook(() => mod.useStartDiscovery());

    const typedConfig = getUseMutationConfig();
    await typedConfig.mutationFn({
      issue_areas: ["housing_affordability"],
      location_query: "Kansas City",
      state: "MO",
    });
    expect(mocks.startDiscoveryRun).toHaveBeenCalledWith({
      data: {
        issue_areas: ["housing_affordability"],
        location_query: "Kansas City",
        state: "MO",
      },
    });
    await typedConfig.onSuccess?.();

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["discovery", "runs"],
    });
  });
});
