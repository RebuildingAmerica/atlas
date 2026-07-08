import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeLoader } from "./support";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("research-summary loader calls", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls lists, feed, and discovery-run endpoints in parallel with the user's identity", async () => {
    mocks.requestAtlasApi.mockImplementation((path: string) => {
      if (path === "/lists") return Promise.resolve([]);
      if (path === "/feed/following?limit=50") return Promise.resolve({ items: [] });
      if (path === "/discovery-runs") return Promise.resolve({ items: [], total: 0 });
      throw new Error(`unexpected path: ${path}`);
    });

    const response = await executeLoader();

    expect(response.error).toBeUndefined();
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/lists");
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/feed/following?limit=50");
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-runs");
  });

  it("returns an empty-but-valid summary when an upstream call fails", async () => {
    mocks.requestAtlasApi.mockRejectedValue(new Error("Atlas API request failed (503)"));

    const response = await executeLoader();

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      lists: [],
      activity: { newSourcesThisWeek: 0, recentItems: [], followedActorCount: 0 },
      recentRuns: [],
      researchTrends: [],
      totals: { savedActors: 0, listCount: 0, runsThisMonth: 0 },
      watchlists: [],
    });
  });
});
