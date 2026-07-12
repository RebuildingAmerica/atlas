import { createServerFn } from "@tanstack/react-start";
import { requestAtlasApi, requestAtlasService } from "@/domains/discovery/server/api-client";
import type { CloudCostPostureResponse } from "./cloud-costs.functions";

interface ApiHealthResponse {
  status: string;
}

interface DiscoveryPipelineSummary {
  completed_runs_total: number;
  enabled_schedules: number;
  failed_jobs: number;
  last_completed_run_at: string | null;
  queued_jobs: number;
  running_jobs: number;
  total_entries_confirmed: number;
}

export interface AdminDashboardSummary {
  api: ApiHealthResponse;
  cloud_costs: CloudCostPostureResponse;
  discovery: DiscoveryPipelineSummary;
}

export const loadAdminDashboardSummary = createServerFn({ method: "GET" }).handler(async () => {
  const [api, discovery, cloudCosts] = await Promise.all([
    requestAtlasService<ApiHealthResponse>("/health"),
    requestAtlasApi<DiscoveryPipelineSummary>("/discovery-runs/summary"),
    requestAtlasApi<CloudCostPostureResponse>("/admin/cloud-costs"),
  ]);

  return {
    api,
    cloud_costs: cloudCosts,
    discovery,
  } satisfies AdminDashboardSummary;
});
