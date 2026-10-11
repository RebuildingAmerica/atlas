import type { Pool } from "pg";
export const AUTH_SCHEMA_VERSION = "atlas-web-2026-10-10";
export async function verifyAuthSchema(pool: Pool | null): Promise<void> {
  if (!pool) throw new Error("External auth migrations require PostgreSQL.");
  const result = await pool.query<{ version: string }>(
    "SELECT version FROM atlas_runtime_schema WHERE name = $1",
    ["web"],
  );
  if (result.rows[0]?.version !== AUTH_SCHEMA_VERSION)
    throw new Error("Atlas auth schema is not ready; run the release migration job.");
}
