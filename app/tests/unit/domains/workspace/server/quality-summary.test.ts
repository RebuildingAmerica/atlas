import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFnExecutionResponse } from "../../../../helpers/server-fn-stub";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
  requireReadyAtlasSessionState: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

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

describe("workspace quality summary server function", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: { activeOrganization: { id: "org_123" } },
    });
  });

  it("returns the workspace quality summary through the GET server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ org_id: "org_123" });

    const { loadWorkspaceQualitySummary } =
      await import("@/domains/workspace/server/quality-summary");
    const response = (await loadWorkspaceQualitySummary.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ org_id: "org_123" });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/quality-summary");
  });
});
