import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectSummary, executeLoader, makeList, makeRun } from "./support";

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

describe("research-summary watchlists", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestWorkspaceApi.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives place and issue watchlists from discovery runs", async () => {
    mocks.requestWorkspaceApi.mockImplementation((path: string) => {
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
    mocks.requestWorkspaceApi.mockImplementation((path: string) => {
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

  it("reads a one-actor research set in the singular and keeps an unlabelled issue as-is", async () => {
    mocks.requestWorkspaceApi.mockImplementation((path: string) => {
      if (path === "/lists") {
        return Promise.resolve([makeList({ id: "list_solo", name: "Solo", item_count: 1 })]);
      }
      if (path === "/feed/following?limit=50") return Promise.resolve({ items: [] });
      return Promise.resolve({
        items: [
          makeRun({ id: "run_1", issue_areas: ["__"] }),
          makeRun({ id: "run_2", issue_areas: ["__"] }),
        ],
        total: 2,
      });
    });

    const summary = expectSummary(await executeLoader());

    expect(summary.watchlists).toContainEqual(
      expect.objectContaining({
        detail: "1 saved actor",
        id: "research_set:list_solo",
        kind: "research_set",
      }),
    );
    expect(summary.watchlists).toContainEqual(
      expect.objectContaining({ id: "issue:__", kind: "issue", label: "__" }),
    );
  });
});
