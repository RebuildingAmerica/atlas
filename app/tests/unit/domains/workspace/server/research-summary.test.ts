import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchSummary } from "@/domains/workspace/server/research-summary";
import type { ServerFnExecutionResponse } from "../../../../helpers/server-fn-stub";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("research-summary loader", () => {
  interface RawList {
    id: string;
    name: string;
    description?: string | null;
    item_count?: number;
  }

  interface RawFeedItem {
    entry_id: string;
    entry_name: string;
    entry_slug?: string | null;
    entry_type: string;
    source_id: string;
    source_url: string;
    source_title?: string | null;
    source_publication?: string | null;
    ingested_at: string;
  }

  interface RawRun {
    id: string;
    location_query: string;
    state: string;
    status: string;
    started_at: string;
  }

  const REFERENCE_NOW = Date.parse("2026-06-24T00:00:00.000Z");

  function isoDaysAgo(days: number): string {
    return new Date(REFERENCE_NOW - days * 24 * 60 * 60 * 1000).toISOString();
  }

  function makeList(overrides: Partial<RawList> = {}): RawList {
    return { id: "list_1", name: "Climate", description: "Greens", item_count: 4, ...overrides };
  }

  function makeFeedItem(overrides: Partial<RawFeedItem> = {}): RawFeedItem {
    return {
      entry_id: "entry_1",
      entry_name: "Jane Doe",
      entry_slug: "jane-doe",
      entry_type: "person",
      source_id: "src_1",
      source_url: "https://example.test/a",
      source_title: "A headline",
      source_publication: "Local Paper",
      ingested_at: isoDaysAgo(1),
      ...overrides,
    };
  }

  function makeRun(overrides: Partial<RawRun> = {}): RawRun {
    return {
      id: "run_1",
      location_query: "Kansas City, MO",
      state: "MO",
      status: "completed",
      started_at: isoDaysAgo(2),
      ...overrides,
    };
  }

  async function executeLoader(): Promise<ServerFnExecutionResponse<ResearchSummary>> {
    const { loadResearchSummary } = await import("@/domains/workspace/server/research-summary");
    return (await loadResearchSummary.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse<ResearchSummary>;
  }

  function expectSummary(response: ServerFnExecutionResponse<ResearchSummary>): ResearchSummary {
    expect(response.error).toBeUndefined();
    const { result } = response;
    if (!result) {
      throw new Error("expected a research summary result");
    }
    return result;
  }

  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(REFERENCE_NOW);
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

  it("projects lists and totals across saved lists, defaulting a missing item_count to zero", async () => {
    mocks.requestAtlasApi.mockImplementation((path: string) => {
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
    mocks.requestAtlasApi.mockImplementation((path: string) => {
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

    // s1, s2, s5, s6 fall within 7 days; s3 is too old and s4 is unparseable.
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
    mocks.requestAtlasApi.mockImplementation((path: string) => {
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
    mocks.requestAtlasApi.mockImplementation((path: string) => {
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
      },
      expect.objectContaining({ id: "r2" }),
      expect.objectContaining({ id: "r3" }),
    ]);
  });

  it("returns an empty-but-valid summary when an upstream call fails", async () => {
    mocks.requestAtlasApi.mockRejectedValue(new Error("Atlas API request failed (503)"));

    const response = await executeLoader();

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      lists: [],
      activity: { newSourcesThisWeek: 0, recentItems: [], followedActorCount: 0 },
      recentRuns: [],
      totals: { savedActors: 0, listCount: 0, runsThisMonth: 0 },
    });
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
    mocks.requestAtlasApi.mockImplementation((path: string) => {
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
