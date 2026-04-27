import "@tanstack/react-start/server-only";

import type Database from "better-sqlite3";
import type { Pool } from "pg";

export interface AtlasMigration {
  version: number;
  name: string;
  sqlite: string;
  pg?: string;
}

const TRACKING_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS _atlas_migrations (
  version   INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)
`;

const TRACKING_TABLE_SQL_PG = `
CREATE TABLE IF NOT EXISTS _atlas_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
`;

const WORKSPACE_PRODUCTS_SQLITE = `
CREATE TABLE workspace_products (
    id                     TEXT PRIMARY KEY,
    workspace_id           TEXT NOT NULL,
    product                TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'active',
    granted_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at             TEXT,
    stripe_subscription_id TEXT,
    stripe_customer_id     TEXT,
    UNIQUE(workspace_id, product)
);
CREATE INDEX idx_workspace_products_workspace ON workspace_products(workspace_id);
`;

const WORKSPACE_PRODUCTS_PG = `
CREATE TABLE workspace_products (
    id                     TEXT PRIMARY KEY,
    workspace_id           TEXT NOT NULL,
    product                TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'active',
    granted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at             TIMESTAMPTZ,
    stripe_subscription_id TEXT,
    stripe_customer_id     TEXT,
    UNIQUE(workspace_id, product)
);
CREATE INDEX idx_workspace_products_workspace ON workspace_products(workspace_id);
`;

const ADD_EVENT_AT_SQLITE = `
ALTER TABLE workspace_products ADD COLUMN stripe_event_at TEXT;
`;

const ADD_EVENT_AT_PG = `
ALTER TABLE workspace_products ADD COLUMN stripe_event_at TIMESTAMPTZ;
`;

export const ATLAS_MIGRATIONS: AtlasMigration[] = [
  {
    version: 1,
    name: "create_workspace_products",
    sqlite: WORKSPACE_PRODUCTS_SQLITE,
    pg: WORKSPACE_PRODUCTS_PG,
  },
  {
    version: 2,
    name: "add_workspace_products_stripe_event_at",
    sqlite: ADD_EVENT_AT_SQLITE,
    pg: ADD_EVENT_AT_PG,
  },
];

/**
 * Runs pending Atlas custom migrations against a SQLite database.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param migrations - Ordered list of migrations to apply.
 */
export function runAtlasCustomMigrations(
  db: Database.Database,
  migrations: AtlasMigration[],
): void {
  db.exec(TRACKING_TABLE_SQL);

  const appliedRows = db.prepare("SELECT version FROM _atlas_migrations").all() as {
    version: number;
  }[];
  const applied = new Set(appliedRows.map((r) => r.version));

  const pending = migrations.filter((m) => !applied.has(m.version));
  const sorted = [...pending].sort((a, b) => a.version - b.version);

  for (const migration of sorted) {
    db.transaction(() => {
      db.exec(migration.sqlite);
      db.prepare("INSERT INTO _atlas_migrations (version, name) VALUES (?, ?)").run(
        migration.version,
        migration.name,
      );
    })();
  }
}

/**
 * Runs pending Atlas custom migrations against a PostgreSQL connection pool.
 *
 * @param pool - The pg Pool instance.
 * @param migrations - Ordered list of migrations to apply.
 */
export async function runAtlasCustomMigrationsPg(
  pool: Pool,
  migrations: AtlasMigration[],
): Promise<void> {
  await pool.query(TRACKING_TABLE_SQL_PG);

  const result = await pool.query("SELECT version FROM _atlas_migrations");
  const applied = new Set((result.rows as { version: number }[]).map((r) => r.version));

  const pending = migrations.filter((m) => !applied.has(m.version));
  const sorted = [...pending].sort((a, b) => a.version - b.version);

  for (const migration of sorted) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration.pg ?? migration.sqlite);
      await client.query("INSERT INTO _atlas_migrations (version, name) VALUES ($1, $2)", [
        migration.version,
        migration.name,
      ]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
