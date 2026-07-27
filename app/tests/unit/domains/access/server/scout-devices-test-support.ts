/** A `scout_devices` row exactly as the database hands it back. */
export interface StoredScoutDeviceRow {
  created_at: Date | string;
  default_upload_target: string;
  id: string;
  last_seen_at: Date | string;
  revoked_at: Date | string | null;
  search_key_configured: boolean | number;
  user_id: string;
  worker_name: string;
  workspace_id: string | null;
}

/** What the stubbed pool answers a device statement with. */
export interface ScoutDeviceQueryResult {
  rowCount?: number;
  rows: StoredScoutDeviceRow[];
}

/**
 * The parameterized statement the PostgreSQL-backed device store issues, so a
 * test can read the values it bound rather than guess at them.
 */
export type ScoutDevicePoolQuery = (
  sql: string,
  values: unknown[],
) => Promise<ScoutDeviceQueryResult>;

/**
 * Builds a stored device row for the PostgreSQL-backed tests.
 *
 * @param overrides - Columns to replace on the baseline row.
 */
export function storedScoutDeviceRow(
  overrides: Partial<StoredScoutDeviceRow> = {},
): StoredScoutDeviceRow {
  return {
    created_at: "2026-07-04T16:00:00.000Z",
    default_upload_target: "workspace",
    id: "worker-123",
    last_seen_at: "2026-07-04T16:00:00.000Z",
    revoked_at: null,
    search_key_configured: true,
    user_id: "user-123",
    worker_name: "Laptop",
    workspace_id: "org-123",
    ...overrides,
  };
}
