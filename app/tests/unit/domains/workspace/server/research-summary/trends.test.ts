import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectSummary, executeLoader, isoDaysAgo, makeRun } from "./support";

const mocks = vi.hoisted(() => ({
  requestWorkspaceApi: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/workspace/server/workspace-api", () => ({
  requestWorkspaceApi: mocks.requestWorkspaceApi,
}));

describe("research-summary trends", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestWorkspaceApi.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives longitudinal research trends from repeated places and issues", async () => {
    mocks.requestWorkspaceApi.mockImplementation((path: string) => {
      if (path === "/lists") return Promise.resolve([]);
      if (path === "/feed/following?limit=50") return Promise.resolve({ items: [] });
      return Promise.resolve({
        items: [
          makeRun({
            id: "kc-housing-new",
            location_query: "Kansas City, MO",
            started_at: isoDaysAgo(1),
          }),
          makeRun({
            id: "kc-housing-old",
            location_query: "Kansas City, MO",
            started_at: isoDaysAgo(15),
          }),
          makeRun({
            id: "detroit-housing",
            location_query: "Detroit, MI",
            state: "MI",
            issue_areas: ["housing_affordability", "public_transit"],
            started_at: isoDaysAgo(3),
          }),
          makeRun({
            id: "atlanta-transit",
            location_query: "Atlanta, GA",
            state: "GA",
            issue_areas: ["public_transit"],
            started_at: isoDaysAgo(30),
          }),
        ],
        total: 4,
      });
    });

    const summary = expectSummary(await executeLoader());

    expect(summary.researchTrends).toEqual([
      {
        id: "place:kansas city, mo:mo",
        kind: "place",
        label: "Kansas City, MO",
        runCount: 2,
        latestRunAt: isoDaysAgo(1),
        signal: "2 requests over time",
      },
      {
        id: "issue:housing_affordability",
        kind: "issue",
        label: "Housing affordability",
        runCount: 3,
        latestRunAt: isoDaysAgo(1),
        signal: "3 requests over time",
      },
      {
        id: "issue:public_transit",
        kind: "issue",
        label: "Public transit",
        runCount: 2,
        latestRunAt: isoDaysAgo(3),
        signal: "2 requests over time",
      },
    ]);
  });
});
