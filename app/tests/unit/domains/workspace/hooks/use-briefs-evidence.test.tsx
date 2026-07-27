// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRecordWorkspaceEvidenceOpen } from "@/domains/workspace/hooks/use-briefs";
import { createTestQueryClient } from "../../../../helpers/render-with-providers";

const mocks = vi.hoisted(() => ({
  recordWorkspaceEvidenceOpen: vi.fn(),
}));

vi.mock("@/domains/workspace/server/usage-summary", () => ({
  recordWorkspaceEvidenceOpen: mocks.recordWorkspaceEvidenceOpen,
}));

describe("useRecordWorkspaceEvidenceOpen", () => {
  beforeEach(() => {
    mocks.recordWorkspaceEvidenceOpen.mockReset();
  });

  it("records the surface a reader opened a source receipt from", async () => {
    mocks.recordWorkspaceEvidenceOpen.mockResolvedValue({
      event_type: "evidence_opened",
      id: "event_1",
    });
    const queryClient = createTestQueryClient();

    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useRecordWorkspaceEvidenceOpen(), { wrapper: Wrapper });
    result.current.mutate({ sourceId: "src_1", surface: "brief" });

    await waitFor(() => {
      expect(result.current.data).toEqual({ event_type: "evidence_opened", id: "event_1" });
    });
    expect(mocks.recordWorkspaceEvidenceOpen).toHaveBeenCalledWith({
      data: { sourceId: "src_1", surface: "brief" },
    });
  });
});
