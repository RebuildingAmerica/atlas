// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  researchSummaryQueryOptions,
  useResearchSummary,
} from "@/domains/workspace/hooks/use-research-summary";
import type { ResearchSummary } from "@/domains/workspace/server/research-summary";

const mocks = vi.hoisted(() => ({
  loadResearchSummary: vi.fn(),
  queryOptions: vi.fn((options: unknown) => options),
  useSuspenseQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  queryOptions: mocks.queryOptions,
  useSuspenseQuery: mocks.useSuspenseQuery,
}));

vi.mock("@/domains/workspace/server/research-summary", () => ({
  loadResearchSummary: mocks.loadResearchSummary,
}));

describe("useResearchSummary", () => {
  const initialSummary: ResearchSummary = {
    lists: [{ id: "list_1", name: "Climate", description: null, itemCount: 2 }],
    activity: { newSourcesThisWeek: 3, recentItems: [], followedActorCount: 1 },
    recentRuns: [],
    totals: { savedActors: 2, listCount: 1, runsThisMonth: 0 },
    watchlists: [],
  };

  beforeEach(() => {
    mocks.loadResearchSummary.mockReset();
    mocks.queryOptions.mockClear();
    mocks.useSuspenseQuery.mockReset();
    mocks.useSuspenseQuery.mockReturnValue({ data: initialSummary });
  });

  it("builds reusable query options for the research summary", async () => {
    const options = researchSummaryQueryOptions();

    expect(mocks.queryOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["workspace", "research-summary"],
      }),
    );
    const queryFn = options.queryFn as () => Promise<unknown>;
    await queryFn();
    expect(mocks.loadResearchSummary).toHaveBeenCalledWith();
  });

  it("returns the cached summary to callers", () => {
    const { result } = renderHook(() => useResearchSummary());
    expect(result.current.data).toBe(initialSummary);
  });

  it("reads the summary through suspense query", () => {
    renderHook(() => useResearchSummary());

    expect(mocks.useSuspenseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["workspace", "research-summary"],
      }),
    );
  });
});
