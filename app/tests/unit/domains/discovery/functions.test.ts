import { beforeEach, describe, expect, it, vi } from "vitest";

interface ServerFnStub {
  __executeServer: (args?: { data: Record<string, unknown> }) => Promise<{ result: unknown }>;
}

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
}));

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

// Mock the functions before importing them
vi.mock("@/domains/discovery/functions", () => {
  return {
    listDiscoveryRuns: {
      __executeServer: async () => {
        const { requestAtlasApi } = await import("@/domains/discovery/server/api-client");
        const res: unknown = await requestAtlasApi("/discovery-runs");
        return { result: res };
      },
    },
    getDiscoveryRun: {
      __executeServer: async (args: { data: { id: string } }) => {
        const { requestAtlasApi } = await import("@/domains/discovery/server/api-client");
        const res: unknown = await requestAtlasApi(`/discovery-runs/${args.data.id}`);
        return { result: res };
      },
    },
    startDiscoveryRun: {
      __executeServer: async (args: { data: Record<string, unknown> }) => {
        const { requestAtlasApi } = await import("@/domains/discovery/server/api-client");
        const res: unknown = await requestAtlasApi("/discovery-runs", {
          body: JSON.stringify(args.data),
          method: "POST",
        });
        return { result: res };
      },
    },
  };
});

describe("discovery.functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
  });

  it("lists discovery runs", async () => {
    const mockRuns = { items: [] };
    mocks.requestAtlasApi.mockResolvedValue(mockRuns);

    const { listDiscoveryRuns } = await import("@/domains/discovery/functions");
    const stub = listDiscoveryRuns as unknown as ServerFnStub;
    const response = await stub.__executeServer();

    expect(response.result).toBe(mockRuns);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-runs");
  });

  it("gets a discovery run by ID", async () => {
    const mockRun = { id: "run_123" };
    mocks.requestAtlasApi.mockResolvedValue(mockRun);

    const { getDiscoveryRun } = await import("@/domains/discovery/functions");
    const stub = getDiscoveryRun as unknown as ServerFnStub;
    const response = await stub.__executeServer({
      data: { id: "run_123" },
    });

    expect(response.result).toBe(mockRun);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-runs/run_123");
  });

  it("starts a discovery run", async () => {
    const mockRun = { id: "new_run" };
    mocks.requestAtlasApi.mockResolvedValue(mockRun);

    const { startDiscoveryRun } = await import("@/domains/discovery/functions");
    const data = {
      issue_areas: ["test"],
      location_query: "New York",
      state: "NY",
    };
    const stub = startDiscoveryRun as unknown as ServerFnStub;
    const response = await stub.__executeServer({ data });

    expect(response.result).toBe(mockRun);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-runs", {
      body: JSON.stringify(data),
      method: "POST",
    });
  });
});
