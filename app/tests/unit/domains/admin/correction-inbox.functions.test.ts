import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestAtlasApi: vi.fn() }));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});
vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

afterEach(() => {
  vi.resetModules();
  mocks.requestAtlasApi.mockReset();
});

describe("correction inbox server functions", () => {
  it("maps a mixed private inbox response to profile and source context", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      items: [
        {
          created_at: "2026-09-27T17:00:00Z",
          entity_slug: "las-vegas-civic-group",
          entity_type: "organization",
          id: "report-1",
          note: "Private correction",
          reason: "incorrect",
          source_url: null,
          target_id: "entry-1",
          target_name: "Las Vegas Civic Group",
          target_type: "entity",
        },
        {
          created_at: "2026-09-27T18:00:00Z",
          entity_slug: null,
          entity_type: null,
          id: "report-2",
          note: "Source is stale",
          reason: "outdated_source",
          source_url: "https://example.org/source",
          target_id: "source-1",
          target_name: "Official source",
          target_type: "source",
        },
      ],
      total: 2,
    });
    const { listCorrectionReports } = await import("@/domains/admin/correction-inbox.functions");
    const page = await listCorrectionReports({ data: { offset: 25 } });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/correction-inbox?limit=25&offset=25");
    expect(page).toEqual({
      items: [
        {
          createdAt: "2026-09-27T17:00:00Z",
          entitySlug: "las-vegas-civic-group",
          entityType: "organization",
          id: "report-1",
          note: "Private correction",
          reason: "incorrect",
          sourceUrl: null,
          targetId: "entry-1",
          targetName: "Las Vegas Civic Group",
          targetType: "entity",
        },
        {
          createdAt: "2026-09-27T18:00:00Z",
          entitySlug: null,
          entityType: null,
          id: "report-2",
          note: "Source is stale",
          reason: "outdated_source",
          sourceUrl: "https://example.org/source",
          targetId: "source-1",
          targetName: "Official source",
          targetType: "source",
        },
      ],
      total: 2,
    });
  });

  it("sends the selected report disposition to the protected API", async () => {
    const reportId = "7cb2c69a-f22b-4f4e-ab83-16872c9fd59e";
    mocks.requestAtlasApi.mockResolvedValue({ id: reportId, status: "resolved" });
    const { decideCorrectionReport } = await import("@/domains/admin/correction-inbox.functions");
    const result = await decideCorrectionReport({
      data: { decision: "resolve", reportId, targetType: "source" },
    });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(`/source-flags/${reportId}/resolve`, {
      method: "POST",
    });
    expect(result).toEqual({ id: reportId, status: "resolved" });
  });

  it("routes a profile decision to its own flag", async () => {
    const reportId = "7cb2c69a-f22b-4f4e-ab83-16872c9fd59e";
    mocks.requestAtlasApi.mockResolvedValue({ id: reportId, status: "resolved" });
    const { decideCorrectionReport } = await import("@/domains/admin/correction-inbox.functions");
    const result = await decideCorrectionReport({
      data: { decision: "resolve", reportId, targetType: "entity" },
    });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(`/entity-flags/${reportId}/resolve`, {
      method: "POST",
    });
    expect(result).toEqual({ id: reportId, status: "resolved" });
  });
});
