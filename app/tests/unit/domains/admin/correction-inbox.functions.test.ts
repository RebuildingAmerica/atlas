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
  it("maps a private inbox response to profile context", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      items: [
        {
          created_at: "2026-09-27T17:00:00Z",
          entity_id: "entry-1",
          entity_name: "Las Vegas Civic Group",
          entity_slug: "las-vegas-civic-group",
          entity_type: "organization",
          id: "report-1",
          note: "Private correction",
          reason: "incorrect",
        },
      ],
      total: 1,
    });
    const { listCorrectionReports } = await import("@/domains/admin/correction-inbox.functions");
    const page = await listCorrectionReports({ data: { offset: 25 } });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/entity-flags/inbox?limit=25&offset=25");
    expect(page).toEqual({
      items: [
        {
          createdAt: "2026-09-27T17:00:00Z",
          entityId: "entry-1",
          entityName: "Las Vegas Civic Group",
          entitySlug: "las-vegas-civic-group",
          entityType: "organization",
          id: "report-1",
          note: "Private correction",
          reason: "incorrect",
        },
      ],
      total: 1,
    });
  });

  it("sends the selected report disposition to the protected API", async () => {
    const reportId = "7cb2c69a-f22b-4f4e-ab83-16872c9fd59e";
    mocks.requestAtlasApi.mockResolvedValue({ id: reportId, status: "resolved" });
    const { decideCorrectionReport } = await import("@/domains/admin/correction-inbox.functions");
    const result = await decideCorrectionReport({ data: { decision: "resolve", reportId } });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(`/entity-flags/${reportId}/resolve`, {
      method: "POST",
    });
    expect(result).toEqual({ id: reportId, status: "resolved" });
  });
});
