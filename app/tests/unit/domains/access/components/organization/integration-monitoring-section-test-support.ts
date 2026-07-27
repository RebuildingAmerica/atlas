import type { WorkspaceIntegrationMonitoring } from "@/domains/workspace/server/usage-summary";

type IntegrationResource = WorkspaceIntegrationMonitoring["top_resources"][number];

/**
 * Builds one most-used integration path as the workspace usage API returns it.
 *
 * @param overrides - Fields this test cares about.
 */
export function createIntegrationResource(
  overrides: Partial<IntegrationResource> = {},
): IntegrationResource {
  return {
    last_seen_at: "2026-07-03T12:00:00.000Z",
    resource_id: "GET /api/entries",
    surface: "api",
    total_calls: 12,
    ...overrides,
  };
}

/**
 * Builds a workspace integration activity rollup with the privacy-preserving
 * defaults Atlas ships.
 *
 * @param overrides - Fields this test cares about.
 */
export function createIntegrationMonitoring(
  overrides: Partial<WorkspaceIntegrationMonitoring> = {},
): WorkspaceIntegrationMonitoring {
  return {
    api_calls: 0,
    data_boundary: {
      request_metadata_included: false,
      session_replay_included: false,
      statement: "Only call counts are retained.",
    },
    last_seen_at: null,
    mcp_calls: 0,
    org_id: "org_team",
    top_resources: [],
    total_calls: 0,
    ...overrides,
  };
}
