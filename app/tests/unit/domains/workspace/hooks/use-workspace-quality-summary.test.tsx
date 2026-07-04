// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadWorkspaceQualitySummary: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@/domains/workspace/server/quality-summary", () => ({
  loadWorkspaceQualitySummary: mocks.loadWorkspaceQualitySummary,
}));

describe("workspace quality summary hook", () => {
  interface QualitySummaryQueryConfig {
    queryFn(): Promise<unknown>;
    queryKey: readonly string[];
  }

  beforeEach(() => {
    vi.resetModules();
    mocks.loadWorkspaceQualitySummary.mockReset();
    mocks.useQuery.mockReset();
    mocks.useQuery.mockReturnValue({ data: null, isLoading: false });
  });

  function queryConfig(): QualitySummaryQueryConfig {
    const call = mocks.useQuery.mock.calls.at(0) as [unknown] | undefined;
    if (!call) {
      throw new TypeError("Expected useQuery to receive a config object.");
    }

    return call[0] as QualitySummaryQueryConfig;
  }

  it("loads the active workspace quality summary", async () => {
    const mod = await import("@/domains/workspace/hooks/use-workspace-quality-summary");
    renderHook(() => mod.useWorkspaceQualitySummary());

    const config = queryConfig();
    expect(config.queryKey).toEqual(["workspace", "quality-summary"]);
    await config.queryFn();
    expect(mocks.loadWorkspaceQualitySummary).toHaveBeenCalledWith();
  });
});
