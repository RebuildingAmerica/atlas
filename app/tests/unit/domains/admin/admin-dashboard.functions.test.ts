import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
  requestAtlasService: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
  requestAtlasService: mocks.requestAtlasService,
}));

describe("admin dashboard server functions", () => {
  afterEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requestAtlasService.mockReset();
  });

  it("loads the instance's health and discovery pipeline, and nothing from the platform", async () => {
    mocks.requestAtlasService.mockResolvedValueOnce({ status: "ok" });
    mocks.requestAtlasApi.mockResolvedValueOnce({
      completed_runs_total: 9,
      enabled_schedules: 2,
      failed_jobs: 1,
      last_completed_run_at: "2026-07-12T07:00:00Z",
      queued_jobs: 4,
      running_jobs: 1,
      total_entries_confirmed: 42,
    });

    const { loadAdminDashboardSummary } = await import("@/domains/admin/admin-dashboard.functions");

    const result = await loadAdminDashboardSummary();

    expect(result.api.status).toBe("ok");
    expect(result.discovery.failed_jobs).toBe(1);
    expect(mocks.requestAtlasService).toHaveBeenCalledWith("/health");
    expect(mocks.requestAtlasApi).toHaveBeenCalledTimes(1);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/discovery-runs/summary");
  });
});
