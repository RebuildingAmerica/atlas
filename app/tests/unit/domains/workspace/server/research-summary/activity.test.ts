import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  expectSummary,
  executeLoader,
  isoDaysAgo,
  makeFeedItem,
  makeList,
  makeRun,
} from "./support";

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

describe("research-summary activity", () => {
  const REFERENCE_NOW = Date.parse("2026-06-24T00:00:00.000Z");

  beforeEach(() => {
    vi.resetModules();
    mocks.requestWorkspaceApi.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(REFERENCE_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("projects lists and totals across saved lists, defaulting a missing item_count to zero", async () => {
    mocks.requestWorkspaceApi.mockImplementation((path: string) => {
      if (path === "/lists") {
        return Promise.resolve([
          makeList({ id: "list_1", item_count: 4 }),
          makeList({ id: "list_2", name: "Housing", description: null, item_count: undefined }),
        ]);
      }
      if (path === "/feed/following?limit=50") return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [], total: 0 });
    });

    const summary = expectSummary(await executeLoader());

    expect(summary.lists).toEqual([
      { id: "list_1", name: "Climate", description: "Greens", itemCount: 4 },
      { id: "list_2", name: "Housing", description: null, itemCount: 0 },
    ]);
    expect(summary.totals).toEqual({ savedActors: 4, listCount: 2, runsThisMonth: 0 });
  });

  it("counts only sources ingested within the trailing week and limits inline items to five", async () => {
    mocks.requestWorkspaceApi.mockImplementation((path: string) => {
      if (path === "/lists") return Promise.resolve([]);
      if (path === "/feed/following?limit=50") {
        return Promise.resolve({
          items: [
            makeFeedItem({ source_id: "s1", ingested_at: isoDaysAgo(0) }),
            makeFeedItem({ source_id: "s2", ingested_at: isoDaysAgo(6) }),
            makeFeedItem({ source_id: "s3", ingested_at: isoDaysAgo(8) }),
            makeFeedItem({ source_id: "s4", ingested_at: "not-a-date" }),
            makeFeedItem({ source_id: "s5", ingested_at: isoDaysAgo(1) }),
            makeFeedItem({ source_id: "s6", ingested_at: isoDaysAgo(2) }),
          ],
        });
      }
      return Promise.resolve({ items: [], total: 0 });
    });

    const summary = expectSummary(await executeLoader());

    expect(summary.activity.newSourcesThisWeek).toBe(4);
    expect(summary.activity.recentItems).toHaveLength(5);
    expect(summary.activity.recentItems.map((item) => item.sourceId)).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
    ]);
  });

  it("derives the followed-actor count from the distinct feed entries and maps nullable fields", async () => {
    mocks.requestWorkspaceApi.mockImplementation((path: string) => {
      if (path === "/lists") return Promise.resolve([]);
      if (path === "/feed/following?limit=50") {
        return Promise.resolve({
          items: [
            makeFeedItem({ entry_id: "a", source_id: "s1" }),
            makeFeedItem({ entry_id: "a", source_id: "s2" }),
            makeFeedItem({
              entry_id: "b",
              source_id: "s3",
              entry_slug: undefined,
              source_title: undefined,
              source_publication: undefined,
            }),
          ],
        });
      }
      return Promise.resolve({ items: [], total: 0 });
    });

    const summary = expectSummary(await executeLoader());

    expect(summary.activity.followedActorCount).toBe(2);
    expect(summary.activity.recentItems.at(2)).toEqual({
      entryId: "b",
      entryName: "Jane Doe",
      entrySlug: null,
      entryType: "person",
      sourceId: "s3",
      sourceUrl: "https://example.test/a",
      sourceTitle: null,
      sourcePublication: null,
      ingestedAt: isoDaysAgo(1),
    });
  });

  it("limits recent runs to three and projects their summary fields", async () => {
    mocks.requestWorkspaceApi.mockImplementation((path: string) => {
      if (path === "/lists") return Promise.resolve([]);
      if (path === "/feed/following?limit=50") return Promise.resolve({ items: [] });
      return Promise.resolve({
        items: [
          makeRun({ id: "r1" }),
          makeRun({ id: "r2" }),
          makeRun({ id: "r3" }),
          makeRun({ id: "r4" }),
        ],
        total: 4,
      });
    });

    const summary = expectSummary(await executeLoader());

    expect(summary.recentRuns).toEqual([
      {
        id: "r1",
        locationQuery: "Kansas City, MO",
        state: "MO",
        status: "completed",
        startedAt: isoDaysAgo(2),
        issueAreas: ["housing_affordability"],
      },
      expect.objectContaining({ id: "r2" }),
      expect.objectContaining({ id: "r3" }),
    ]);
  });

  it("computes the trailing-week window from the supplied reference time", async () => {
    const { buildResearchSummary } = await import("@/domains/workspace/server/research-summary");

    const summary = buildResearchSummary(
      [],
      {
        items: [
          makeFeedItem({ source_id: "s1", ingested_at: isoDaysAgo(3) }),
          makeFeedItem({ source_id: "s2", ingested_at: isoDaysAgo(10) }),
        ],
      },
      { items: [], total: 0 },
      REFERENCE_NOW,
    );

    expect(summary.activity.newSourcesThisWeek).toBe(1);
  });

  it("counts only the discovery runs started in the reference calendar month", async () => {
    mocks.requestWorkspaceApi.mockImplementation((path: string) => {
      if (path === "/lists") return Promise.resolve([]);
      if (path === "/feed/following?limit=50") return Promise.resolve({ items: [] });
      return Promise.resolve({
        items: [
          makeRun({ id: "this-month", started_at: "2026-06-02T00:00:00.000Z" }),
          makeRun({ id: "also-this-month", started_at: "2026-06-23T00:00:00.000Z" }),
          makeRun({ id: "last-month", started_at: "2026-05-30T00:00:00.000Z" }),
          makeRun({ id: "last-year", started_at: "2025-06-15T00:00:00.000Z" }),
          makeRun({ id: "unparseable", started_at: "not-a-date" }),
        ],
        total: 5,
      });
    });

    const summary = expectSummary(await executeLoader());

    expect(summary.totals.runsThisMonth).toBe(2);
  });
});
