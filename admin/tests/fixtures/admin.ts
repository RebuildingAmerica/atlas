import type {
  CloudCostPostureResponse,
  VerificationRecordResponse,
} from "@/generated/platform-schemas";

/** The admin's production origin, as a deploy would set ATLAS_ADMIN_PUBLIC_URL. */
export const ADMIN_PUBLIC_URL = "https://atlas-admin.rebuildingus.org";

/** A pending student discount request, with any field changed. */
export function discountRequest(
  overrides: Partial<VerificationRecordResponse> = {},
): VerificationRecordResponse {
  return {
    id: "v-1",
    method: "school_email",
    organization_id: "org-1",
    segment: "student",
    status: "pending",
    submitted_at: "2026-10-01T12:00:00Z",
    user_id: "user-1",
    verification_data: { schoolEmail: "student@example.edu" },
    ...overrides,
  };
}

/** A posture with spend comfortably under every ceiling. */
export function passingPosture(): CloudCostPostureResponse {
  return {
    billing_export: { detail: "Not connected.", status: "not_connected" },
    discovery_spend: {
      daily_ceiling_usd: 10,
      estimated_daily_usd: 1,
      kill_switch_enabled: false,
      posture: "pass",
      run_ceiling_usd: 5,
    },
    external_fixed_costs: {
      detail: "Not configured.",
      status: "not_configured",
    },
    generated_at: "2026-10-01T12:00:00Z",
    guardrails: [],
    posture: "pass",
  };
}

/** A decision handler for screens whose decisions a test does not follow. */
export function ignoreDecision(): void {
  // Intentionally empty.
}
