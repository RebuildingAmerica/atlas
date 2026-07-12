import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminDashboardSummary } from "@/domains/admin/admin-dashboard.functions";

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

  it("loads service indicators through existing authenticated API surfaces", async () => {
    mocks.requestAtlasService.mockResolvedValueOnce({ status: "ok" });
    mocks.requestAtlasApi
      .mockResolvedValueOnce({
        completed_runs_total: 9,
        enabled_schedules: 2,
        failed_jobs: 1,
        last_completed_run_at: "2026-07-12T07:00:00Z",
        queued_jobs: 4,
        running_jobs: 1,
        total_entries_confirmed: 42,
      })
      .mockResolvedValueOnce({
        billing_export: {
          detail: "Cloud Billing BigQuery export is not connected yet.",
          status: "not_connected",
        },
        discovery_spend: {
          daily_ceiling_usd: 10,
          estimated_daily_usd: 8,
          kill_switch_enabled: false,
          posture: "warn",
          run_ceiling_usd: 5,
        },
        external_fixed_costs: {
          detail: "External provider fixed costs are not configured yet.",
          status: "not_configured",
        },
        generated_at: "2026-07-12T07:05:00Z",
        guardrails: [],
        posture: "warn",
      } satisfies AdminDashboardSummary["cloud_costs"]);

    const { loadAdminDashboardSummary } = await import("@/domains/admin/admin-dashboard.functions");

    const result = await loadAdminDashboardSummary();

    expect(result.api.status).toBe("ok");
    expect(result.discovery.failed_jobs).toBe(1);
    expect(result.cloud_costs.discovery_spend.posture).toBe("warn");
    expect(mocks.requestAtlasService).toHaveBeenCalledWith("/health");
    expect(mocks.requestAtlasApi).toHaveBeenNthCalledWith(1, "/discovery-runs/summary");
    expect(mocks.requestAtlasApi).toHaveBeenNthCalledWith(2, "/admin/cloud-costs");
  });
});
