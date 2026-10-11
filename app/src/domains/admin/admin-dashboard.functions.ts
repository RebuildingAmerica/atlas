import { createServerFn } from "@tanstack/react-start";
import { requestAtlasApi, requestAtlasService } from "@/domains/discovery/server/api-client";

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
  discovery: DiscoveryPipelineSummary;
}

export const loadAdminDashboardSummary = createServerFn({ method: "GET" }).handler(async () => {
  const [api, discovery] = await Promise.all([
    requestAtlasService<ApiHealthResponse>("/health"),
    requestAtlasApi<DiscoveryPipelineSummary>("/discovery-runs/summary"),
  ]);

  return { api, discovery } satisfies AdminDashboardSummary;
});
