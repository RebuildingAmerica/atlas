// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadWorkspaceUsageSummary: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@/domains/workspace/server/usage-summary", () => ({
  loadWorkspaceUsageSummary: mocks.loadWorkspaceUsageSummary,
}));

describe("workspace usage summary hook", () => {
  interface UsageSummaryQueryConfig {
    enabled: boolean;
    queryFn(): Promise<unknown>;
    queryKey: readonly string[];
  }

  beforeEach(() => {
    vi.resetModules();
    mocks.loadWorkspaceUsageSummary.mockReset();
    mocks.useQuery.mockReset();
    mocks.useQuery.mockReturnValue({ data: null });
  });

  function queryConfig(): UsageSummaryQueryConfig {
    const call = mocks.useQuery.mock.calls.at(0) as [unknown] | undefined;
    if (!call) {
      throw new TypeError("Expected useQuery to receive a config object.");
    }

    return call[0] as UsageSummaryQueryConfig;
  }

  it("loads renewal proof when enabled", async () => {
    const mod = await import("@/domains/workspace/hooks/use-workspace-usage-summary");
    renderHook(() => mod.useWorkspaceUsageSummary(true, "org_123"));

    const config = queryConfig();
    expect(config.queryKey).toEqual(["workspace", "usage-summary", "org_123"]);
    expect(config.enabled).toBe(true);
    await config.queryFn();
    expect(mocks.loadWorkspaceUsageSummary).toHaveBeenCalledWith();
  });
});
