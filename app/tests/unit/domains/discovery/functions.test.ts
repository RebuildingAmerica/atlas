/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test assertions on mock returns */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
}));

vi.mock("./server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

// Mock the functions before importing them
vi.mock("@/domains/discovery/functions", () => {
  return {
    listDiscoveryRuns: {
      __executeServer: async () => {
        const res = await mocks.requestAtlasApi("/discovery-runs");
        return { result: res };
      },
    },
    getDiscoveryRun: {
      __executeServer: async (args: any) => {
        const res = await mocks.requestAtlasApi(`/discovery-runs/${args.data.id}`);
        return { result: res };
      },
    },
    startDiscoveryRun: {
      __executeServer: async (args: any) => {
        const res = await mocks.requestAtlasApi("/discovery-runs", {
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
    const mockRuns = [{ id: "run_1" }];
    mocks.requestAtlasApi.mockResolvedValue(mockRuns);

    const { listDiscoveryRuns } = await import("@/domains/discovery/functions");
    const response = (await listDiscoveryRuns.__executeServer()) as any;

    expect(response.result).toBe(mockRuns);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-runs");
  });

  it("gets a discovery run by ID", async () => {
    const mockRun = { id: "run_123" };
    mocks.requestAtlasApi.mockResolvedValue(mockRun);

    const { getDiscoveryRun } = await import("@/domains/discovery/functions");
    const response = (await getDiscoveryRun.__executeServer({
      data: { id: "run_123" },
    })) as any;

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
    const response = (await startDiscoveryRun.__executeServer({ data })) as any;

    expect(response.result).toBe(mockRun);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-runs", {
      body: JSON.stringify(data),
      method: "POST",
    });
  });
});
