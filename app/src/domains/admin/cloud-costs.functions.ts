import { createServerFn } from "@tanstack/react-start";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";

export type CloudCostPosture = "pass" | "warn" | "block";
export type CloudCostConnectionStatus = "connected" | "not_connected" | "not_configured";

export interface CloudCostGuardrail {
  id: string;
  label: string;
  posture: CloudCostPosture;
  detail: string;
}

export interface DiscoverySpendPosture {
  daily_ceiling_usd: number;
  estimated_daily_usd: number;
  kill_switch_enabled: boolean;
  posture: CloudCostPosture;
  run_ceiling_usd: number;
}

export interface CloudCostConnectionPosture {
  detail: string;
  status: CloudCostConnectionStatus;
}

export interface CloudCostPostureResponse {
  billing_export: CloudCostConnectionPosture;
  discovery_spend: DiscoverySpendPosture;
  external_fixed_costs: CloudCostConnectionPosture;
  generated_at: string;
  guardrails: CloudCostGuardrail[];
  posture: CloudCostPosture;
}

export const loadCloudCostPosture = createServerFn({ method: "GET" }).handler(async () => {
  return await requestAtlasApi<CloudCostPostureResponse>("/admin/cloud-costs");
});
