import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DiscoveryJobQueueResponse,
  DiscoveryRun,
  DiscoveryRunListResponse,
} from "@rebuildingamerica/atlas-api-client";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("discovery server functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
  });

  it("lists discovery runs", async () => {
    const runs = { items: [{ id: "run_1" }], total: 1 };
    mocks.requestAtlasApi.mockResolvedValue(runs);

    const { listDiscoveryRuns } = await import("@/domains/discovery/functions");
    const response = (await listDiscoveryRuns.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse<DiscoveryRunListResponse>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual(runs);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-runs");
  });

  it("lists the discovery job queue at the requested depth", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [], queued: 0, running: 0 });

    const { listDiscoveryJobQueue } = await import("@/domains/discovery/functions");
    const response = (await listDiscoveryJobQueue.__executeServer({
      data: { limit: 25 },
      method: "GET",
    })) as ServerFnExecutionResponse<DiscoveryJobQueueResponse>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ items: [], queued: 0, running: 0 });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-runs/jobs?limit=25");
  });

  it("asks for ten queued jobs when the caller names no depth", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [], queued: 0, running: 0 });

    const { listDiscoveryJobQueue } = await import("@/domains/discovery/functions");
    await listDiscoveryJobQueue.__executeServer({ data: {}, method: "GET" });

    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-runs/jobs?limit=10");
  });

  it("rejects a job queue depth beyond the supported page size", async () => {
    const { listDiscoveryJobQueue } = await import("@/domains/discovery/functions");
    const response = (await listDiscoveryJobQueue.__executeServer({
      data: { limit: 500 },
      method: "GET",
    })) as ServerFnExecutionResponse<DiscoveryJobQueueResponse>;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });

  it("gets one discovery run by id", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ id: "run_123", status: "completed" });

    const { getDiscoveryRun } = await import("@/domains/discovery/functions");
    const response = (await getDiscoveryRun.__executeServer({
      data: { id: "run_123" },
      method: "GET",
    })) as ServerFnExecutionResponse<DiscoveryRun>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ id: "run_123", status: "completed" });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-runs/run_123");
  });

  it("rejects a discovery run lookup with no id", async () => {
    const { getDiscoveryRun } = await import("@/domains/discovery/functions");
    const response = (await getDiscoveryRun.__executeServer({
      data: { id: "" },
      method: "GET",
    })) as ServerFnExecutionResponse<DiscoveryRun>;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });

  it("starts a discovery run from a validated research request", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ id: "new_run", status: "queued" });

    const { startDiscoveryRun } = await import("@/domains/discovery/functions");
    const data = {
      issue_areas: ["housing_affordability"],
      location_query: "Kansas City",
      research_goal: "landscape_scan",
      state: "MO",
    };
    const response = (await startDiscoveryRun.__executeServer({
      data,
      method: "POST",
    })) as ServerFnExecutionResponse<DiscoveryRun>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ id: "new_run", status: "queued" });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-runs", {
      body: JSON.stringify(data),
      method: "POST",
    });
  });

  it("refuses to start a run for an unsupported research goal", async () => {
    const { startDiscoveryRun } = await import("@/domains/discovery/functions");
    const response = (await startDiscoveryRun.__executeServer({
      data: {
        issue_areas: ["housing_affordability"],
        location_query: "Kansas City",
        research_goal: "vibes_check",
        state: "MO",
      },
      method: "POST",
    })) as ServerFnExecutionResponse<DiscoveryRun>;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });

  it("refuses to start a run without a two-letter state", async () => {
    const { startDiscoveryRun } = await import("@/domains/discovery/functions");
    const response = (await startDiscoveryRun.__executeServer({
      data: {
        issue_areas: ["housing_affordability"],
        location_query: "Kansas City",
        research_goal: "landscape_scan",
        state: "Missouri",
      },
      method: "POST",
    })) as ServerFnExecutionResponse<DiscoveryRun>;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });
});
