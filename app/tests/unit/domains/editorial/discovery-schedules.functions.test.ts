import { afterEach, describe, expect, it, vi } from "vitest";
import { API_SCHEDULE, RENO_SCHEDULE } from "../../../fixtures/editorial/discovery-schedules";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
  requestAtlasApiWithoutBody: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});
vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
  requestAtlasApiWithoutBody: mocks.requestAtlasApiWithoutBody,
}));

afterEach(() => {
  vi.resetModules();
  mocks.requestAtlasApi.mockReset();
  mocks.requestAtlasApiWithoutBody.mockReset();
});

describe("discovery schedule server functions", () => {
  it("lists every schedule in the shape the editorial page reads", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [API_SCHEDULE], total: 1 });
    const { listDiscoverySchedules } =
      await import("@/domains/editorial/discovery-schedules.functions");

    await expect(listDiscoverySchedules()).resolves.toEqual([RENO_SCHEDULE]);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-schedules?limit=500");
  });

  it("refuses a search depth it does not know rather than guessing one", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      items: [{ ...API_SCHEDULE, search_depth: "exhaustive" }],
      total: 1,
    });
    const { listDiscoverySchedules } =
      await import("@/domains/editorial/discovery-schedules.functions");

    await expect(listDiscoverySchedules()).rejects.toThrow("unknown search depth: exhaustive");
  });

  it("adds a target with a normalized state code", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ ...API_SCHEDULE, search_depth: "deep" });
    const { createDiscoverySchedule } =
      await import("@/domains/editorial/discovery-schedules.functions");

    const created = await createDiscoverySchedule({
      data: {
        issueAreas: ["housing_affordability"],
        locationQuery: " Reno ",
        searchDepth: "deep",
        state: "nv",
      },
    });

    expect(created.searchDepth).toBe("deep");
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-schedules", {
      body: JSON.stringify({
        issue_areas: ["housing_affordability"],
        location_query: "Reno",
        search_depth: "deep",
        state: "NV",
      }),
      method: "POST",
    });
  });

  it("pauses or resumes one target", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ ...API_SCHEDULE, enabled: false });
    const { setDiscoveryScheduleEnabled } =
      await import("@/domains/editorial/discovery-schedules.functions");

    const updated = await setDiscoveryScheduleEnabled({
      data: { enabled: false, scheduleId: "schedule/1" },
    });

    expect(updated.enabled).toBe(false);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-schedules/schedule%2F1", {
      body: JSON.stringify({ enabled: false }),
      method: "PATCH",
    });
  });

  it("removes a target through the route that answers with no body", async () => {
    mocks.requestAtlasApiWithoutBody.mockResolvedValue(undefined);
    const { deleteDiscoverySchedule } =
      await import("@/domains/editorial/discovery-schedules.functions");

    await expect(deleteDiscoverySchedule({ data: { scheduleId: "schedule-1" } })).resolves.toEqual({
      id: "schedule-1",
    });
    expect(mocks.requestAtlasApiWithoutBody).toHaveBeenCalledWith(
      "/discovery-schedules/schedule-1",
      { method: "DELETE" },
    );
  });
});
