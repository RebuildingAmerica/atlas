import "@tanstack/react-start/server-only";

import type Database from "better-sqlite3";
import type { AtlasProduct } from "../capabilities";
import { getAuthDatabase, getAuthPgPool } from "./auth";

/**
 * Row shape returned by the workspace_products query.
 */
export interface WorkspaceProductRow {
  product: string;
}

/**
 * Row shape returned when tests or admin flows need the persisted product
 * status, not just the active product id.
 */
export interface WorkspaceProductStatusRow extends WorkspaceProductRow {
  expires_at: string | null;
  status: string;
  stripe_event_at: string | null;
}

/**
 * Row shape returned when reading a workspace's Team subscription id.
 */
interface TeamSubscriptionRow {
  stripe_subscription_id: string | null;
}

/**
 * Product grant Atlas can create without a Stripe checkout event.
 */
export interface WorkspaceProductGrantInput {
  workspaceId: string;
  product: AtlasProduct;
}

/**
 * Builds the stable id used for operator-created product grants.
 *
 * @param input - Workspace and product to grant.
 */
function manualGrantId(input: WorkspaceProductGrantInput): string {
  return `manual_${input.workspaceId}_${input.product}`;
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

/**
 * Grants an active product to a workspace without requiring a Stripe event.
 *
 * This is used for operator-provisioned demo and customer workspaces where the
 * user-facing outcome is immediate access to the real Team workspace surface.
 *
 * @param input - Workspace and product to activate.
 */
export async function grantWorkspaceProduct(input: WorkspaceProductGrantInput): Promise<void> {
  const id = manualGrantId(input);
  const pool = getAuthPgPool();
  if (pool) {
    await pool.query(
      `INSERT INTO workspace_products (id, workspace_id, product, status, expires_at)
       VALUES ($1, $2, $3, 'active', NULL)
       ON CONFLICT (workspace_id, product) DO UPDATE
       SET status = 'active',
           expires_at = NULL,
           granted_at = now()`,
      [id, input.workspaceId, input.product],
    );
    return;
  }

  const db = getAuthDatabase();
  if (!db) {
    throw new Error("Auth database unavailable in current mode");
  }

  db.prepare(
    `INSERT INTO workspace_products (id, workspace_id, product, status, expires_at)
     VALUES (?, ?, ?, 'active', NULL)
     ON CONFLICT (workspace_id, product) DO UPDATE
     SET status = 'active',
         expires_at = NULL,
         granted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).run(id, input.workspaceId, input.product);
}

/**
 * Returns the Stripe subscription ID backing a workspace's active Atlas Team
 * product, or null when the workspace has no active Team subscription.
 *
 * This is the handle seat synchronization uses to adjust the per-seat line
 * item as membership changes.
 *
 * @param workspaceId - The workspace (organization) ID to query.
 */
export async function queryActiveTeamSubscriptionId(workspaceId: string): Promise<string | null> {
  const pool = getAuthPgPool();
  if (pool) {
    const result = await pool.query(
      `SELECT stripe_subscription_id FROM workspace_products
       WHERE workspace_id = $1 AND product = 'atlas_team' AND status = 'active'
       LIMIT 1`,
      [workspaceId],
    );
    const row = (result.rows as TeamSubscriptionRow[])[0];
    return row?.stripe_subscription_id ?? null;
  }

  const db = getAuthDatabase();
  if (db) {
    const row = db
      .prepare(
        `SELECT stripe_subscription_id FROM workspace_products
         WHERE workspace_id = ? AND product = 'atlas_team' AND status = 'active'
         LIMIT 1`,
      )
      .get(workspaceId) as TeamSubscriptionRow | undefined;
    return row?.stripe_subscription_id ?? null;
  }

  return null;
}
