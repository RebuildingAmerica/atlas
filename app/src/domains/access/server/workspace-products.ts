import "@tanstack/react-start/server-only";

import type Database from "better-sqlite3";
import type { AtlasProduct } from "../capabilities";
import { getAuthDatabase, getAuthPgPool } from "./auth";

/**
 * Row shape returned by the workspace_products query.
 */
interface WorkspaceProductRow {
  product: string;
}

/**
 * Queries active products for a workspace from a SQLite database.
 *
 * A product is considered active when its status is 'active' and either its
 * expires_at is NULL or it has not yet expired.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param workspaceId - The workspace (organization) ID to query.
 */
export function queryActiveProductsSqlite(
  db: Database.Database,
  workspaceId: string,
): AtlasProduct[] {
  const rows = db
    .prepare(
      `SELECT product FROM workspace_products
       WHERE workspace_id = ?
         AND status = 'active'
         AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    )
    .all(workspaceId) as WorkspaceProductRow[];

  return rows.map((row) => row.product as AtlasProduct);
}

/**
 * Queries active products for a workspace using the configured auth database.
 *
 * Tries PostgreSQL first when a pool is available, falls back to SQLite, and
 * returns an empty array if neither is available.
 *
 * @param workspaceId - The workspace (organization) ID to query.
 */
export async function queryActiveProducts(workspaceId: string): Promise<AtlasProduct[]> {
  const pool = getAuthPgPool();
  if (pool) {
    const result = await pool.query(
      `SELECT product FROM workspace_products
       WHERE workspace_id = $1
         AND status = 'active'
         AND (expires_at IS NULL OR expires_at > now())`,
      [workspaceId],
    );
    return (result.rows as WorkspaceProductRow[]).map((row) => row.product as AtlasProduct);
  }

  const db = getAuthDatabase();
  if (db) {
    return queryActiveProductsSqlite(db, workspaceId);
  }

  return [];
}
