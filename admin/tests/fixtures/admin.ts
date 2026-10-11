import type {
  AccountLookupResponse,
  CloudCostPostureResponse,
  PlatformSwitchResponse,
  VerificationRecordResponse,
} from "@/generated/platform-schemas";

/** An owner with one team workspace that bought, refunded and asked for a discount. */
export function accountLookup(): AccountLookupResponse {
  return {
    account: {
      created_at: "2026-09-01T12:00:00Z",
      email: "dana@example.org",
      email_verified: true,
      id: "user_dana",
      name: "Dana",
    },
    workspaces: [
      {
        adjustments: [
          {
            amount: 400,
            created_at: "2026-09-04T12:00:00Z",
            currency: "usd",
            kind: "refund",
            reason: "Charged twice",
          },
        ],
        discounts: [
          {
            id: "d-1",
            notes: null,
            segment: "student",
            status: "pending",
            submitted_at: "2026-09-05T12:00:00Z",
          },
        ],
        id: "org_team",
        members: [{ email: "dana@example.org", role: "owner" }],
        name: "Reno Tenants",
        products: [
          {
            expires_at: "2027-09-03T12:00:00Z",
            granted_at: "2026-09-03T12:00:00Z",
            product: "atlas_team",
            purchase_intent_id: "pi_1",
            status: "active",
            stripe_subscription_id: "sub_1",
          },
          {
            expires_at: null,
            granted_at: "2026-08-01T12:00:00Z",
            product: "atlas_research_pass",
            purchase_intent_id: null,
            status: "canceled",
            stripe_subscription_id: null,
          },
        ],
        purchases: [
          {
            created_at: "2026-09-03T11:00:00Z",
            id: "pi_1",
            interval: "month",
            paid_at: "2026-09-03T11:05:00Z",
            product: "atlas_team",
            revocation_reason: null,
            revoked_at: null,
            status: "paid",
          },
          {
            created_at: "2026-08-03T11:00:00Z",
            id: "pi_0",
            interval: "once",
            paid_at: null,
            product: "atlas_research_pass",
            revocation_reason: null,
            revoked_at: "2026-08-04T11:00:00Z",
            status: "revoked",
          },
        ],
        slug: "reno-tenants",
      },
    ],
  };
}

/** Discovery spend, never flipped, and checkout paused by the operator. */
export function platformSwitches(): PlatformSwitchResponse[] {
  return [
    {
      changed_at: null,
      changed_by: null,
      engaged: false,
      name: "discovery_spend",
      reason: null,
    },
    {
      changed_at: "2026-10-09T18:00:00Z",
      changed_by: "willie@rebuildingus.org",
      engaged: true,
      name: "checkout",
      reason: "Stripe is double-charging.",
    },
  ];
}

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
