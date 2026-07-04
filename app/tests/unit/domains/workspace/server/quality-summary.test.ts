import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
  requireReadyAtlasSessionState: vi.fn(),
}));

vi.mock("@/domains/access/server/session-state", () => ({
  requireReadyAtlasSessionState: mocks.requireReadyAtlasSessionState,
}));

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("workspace quality summary server loader", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
  });

  it("loads the active workspace quality summary", async () => {
    const summary = {
      org_id: "org_123",
      source_coverage: {
        total_records: 4,
        source_backed_records: 2,
        unsourced_records: 2,
        coverage_percent: 50,
      },
      duplicate_risk: { cluster_count: 1, record_count: 2, clusters: [] },
      confidence_distribution: [],
      stale_records: { threshold_days: 365, record_count: 1, records: [] },
      data_boundary: {
        private_notes_included: false,
        statement: "Private notes are excluded.",
      },
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(summary);

    const { loadWorkspaceQualitySummaryData } =
      await import("@/domains/workspace/server/quality-summary");
    const result = await loadWorkspaceQualitySummaryData();

    expect(result).toBe(summary);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/quality-summary");
  });
});
