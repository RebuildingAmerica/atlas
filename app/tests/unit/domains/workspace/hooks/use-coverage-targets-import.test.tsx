// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useImportCoverageTargets } from "@/domains/workspace/hooks/use-coverage-targets";
import { createTestQueryClient } from "../../../../helpers/render-with-providers";

const mocks = vi.hoisted(() => ({
  importWorkspaceCoverageTargets: vi.fn(),
  loadWorkspaceCoverageTargets: vi.fn(),
}));

vi.mock("@/domains/workspace/server/coverage-targets", () => ({
  createWorkspaceCoverageTarget: vi.fn(),
  importWorkspaceCoverageTargets: mocks.importWorkspaceCoverageTargets,
  loadWorkspaceCoverage: vi.fn(),
  loadWorkspaceCoverageTargets: mocks.loadWorkspaceCoverageTargets,
}));

describe("useImportCoverageTargets", () => {
  beforeEach(() => {
    mocks.importWorkspaceCoverageTargets.mockReset();
    mocks.loadWorkspaceCoverageTargets.mockReset();
  });

  it("imports the pasted rows and refreshes the workspace target list", async () => {
    mocks.importWorkspaceCoverageTargets.mockResolvedValue({ created: [], imported: 2 });
    mocks.loadWorkspaceCoverageTargets.mockResolvedValue({ items: [], total: 0 });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["workspace", "coverage-targets", "list"], { items: [], total: 0 });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useImportCoverageTargets(), { wrapper: Wrapper });
    result.current.mutate({ csv_text: "name,geography\nKC tenants,Kansas City MO" });

    await waitFor(() => {
      expect(result.current.data).toEqual({ created: [], imported: 2 });
    });
    expect(mocks.importWorkspaceCoverageTargets).toHaveBeenCalledWith({
      data: { csv_text: "name,geography\nKC tenants,Kansas City MO" },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["workspace", "coverage-targets"] });
  });
});
