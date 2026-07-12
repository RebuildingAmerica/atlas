import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudCostPostureResponse } from "@/domains/admin/cloud-costs.functions";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("cloud cost server functions", () => {
  afterEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
  });

  it("loads operator cost posture through the authenticated API bridge", async () => {
    const response: CloudCostPostureResponse = {
      billing_export: {
        detail: "Cloud Billing BigQuery export is not connected yet.",
        status: "not_connected",
      },
      discovery_spend: {
        daily_ceiling_usd: 10,
        estimated_daily_usd: 2.75,
        kill_switch_enabled: false,
        posture: "pass",
        run_ceiling_usd: 5,
      },
      external_fixed_costs: {
        detail: "External provider fixed costs are not configured yet.",
        status: "not_configured",
      },
      generated_at: "2026-07-12T07:00:00Z",
      guardrails: [],
      posture: "warn",
    };
    mocks.requestAtlasApi.mockResolvedValue(response);

    const { loadCloudCostPosture } = await import("@/domains/admin/cloud-costs.functions");

    const result = await loadCloudCostPosture();

    expect(result).toBe(response);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/admin/cloud-costs");
  });
});
