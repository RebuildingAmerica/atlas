// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useResearchSummary } from "@/domains/workspace/hooks/use-research-summary";
import type { ResearchSummary } from "@/domains/workspace/server/research-summary";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  loadResearchSummary: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
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
  };

  beforeEach(() => {
    mocks.useQuery.mockReset();
    mocks.loadResearchSummary.mockReset();
    mocks.useQuery.mockReturnValue({ data: initialSummary });
  });

  it("seeds React Query with the loader payload as initialData", () => {
    renderHook(() => useResearchSummary(initialSummary));

    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["workspace", "research-summary"],
        initialData: initialSummary,
      }),
    );
  });

  it("returns the cached summary to callers", () => {
    const { result } = renderHook(() => useResearchSummary(initialSummary));
    expect(result.current.data).toBe(initialSummary);
  });

  it("revalidates through the server loader", () => {
    const queryFn = vi.fn();
    mocks.useQuery.mockImplementation(({ queryFn: fn }: { queryFn: () => unknown }) => {
      queryFn.mockImplementation(fn);
      return { data: initialSummary };
    });

    renderHook(() => useResearchSummary(initialSummary));
    queryFn();

    expect(mocks.loadResearchSummary).toHaveBeenCalled();
  });
});
