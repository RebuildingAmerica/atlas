import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectSummary, executeLoader, makeList, makeRun } from "./support";

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

describe("research-summary watchlists", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives place and issue watchlists from discovery runs", async () => {
    mocks.requestAtlasApi.mockImplementation((path: string) => {
      if (path === "/lists") return Promise.resolve([]);
      if (path === "/feed/following?limit=50") return Promise.resolve({ items: [] });
      return Promise.resolve({
        items: [
          makeRun({ id: "kc-housing", location_query: "Kansas City, MO" }),
          makeRun({
            id: "kc-transit",
            location_query: "Kansas City, MO",
            issue_areas: ["public_transit"],
          }),
          makeRun({
            id: "detroit-housing",
            location_query: "Detroit, MI",
            state: "MI",
            issue_areas: ["housing_affordability"],
          }),
        ],
        total: 3,
      });
    });

    const summary = expectSummary(await executeLoader());

    expect(summary.watchlists).toEqual([
      {
        id: "place:kansas city, mo:mo",
        kind: "place",
        label: "Kansas City, MO",
        detail: "2 recent requests",
        changedSinceLastTime: "2 new research requests",
      },
      {
        id: "place:detroit, mi:mi",
        kind: "place",
        label: "Detroit, MI",
        detail: "1 recent request",
        changedSinceLastTime: "1 new research request",
      },
      {
        id: "issue:housing_affordability",
        kind: "issue",
        label: "Housing affordability",
        detail: "2 recent requests",
        changedSinceLastTime: "2 new research requests",
      },
      {
        id: "issue:public_transit",
        kind: "issue",
        label: "Public transit",
        detail: "1 recent request",
        changedSinceLastTime: "1 new research request",
      },
    ]);
  });

  it("derives saved research-set watchlists from saved lists", async () => {
    mocks.requestAtlasApi.mockImplementation((path: string) => {
      if (path === "/lists") {
        return Promise.resolve([
          makeList({ id: "list_housing", name: "Housing outreach", item_count: 6 }),
        ]);
      }
      if (path === "/feed/following?limit=50") return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [], total: 0 });
    });

    const summary = expectSummary(await executeLoader());

    expect(summary.watchlists).toEqual([
      {
        id: "research_set:list_housing",
        kind: "research_set",
        label: "Housing outreach",
        detail: "6 saved actors",
        changedSinceLastTime: "6 saved actors",
      },
    ]);
  });
});
