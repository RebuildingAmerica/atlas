import type {
  WorkspaceUsageAuditLog,
  WorkspaceUsageEvent,
} from "@/domains/workspace/server/usage-summary";

/**
 * Builds one customer-safe usage event as the workspace usage API returns it.
 *
 * @param overrides - Fields this test cares about.
 */
export function createUsageEvent(
  overrides: Partial<WorkspaceUsageEvent> = {},
): WorkspaceUsageEvent {
  return {
    actor_id: "user_123",
    created_at: "2026-07-03T12:00:00.000Z",
    event_type: "api_call",
    id: "event_1",
    org_id: "org_team",
    resource_id: "GET /api/entries",
    resource_type: "api",
    ...overrides,
  };
}

/**
 * Builds an audit-log page with the privacy boundary Atlas ships.
 *
 * @param overrides - Fields this test cares about.
 */
export function createUsageAuditLog(
  overrides: Partial<WorkspaceUsageAuditLog> = {},
): WorkspaceUsageAuditLog {
  return {
    data_boundary: {
      metadata_included: false,
      session_replay_included: false,
      statement: "Only timestamped events are retained.",
    },
    items: [],
    limit: 10,
    offset: 0,
    org_id: "org_team",
    total: 0,
    ...overrides,
  };
}
