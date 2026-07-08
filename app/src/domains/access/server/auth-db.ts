import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Pool } from "pg";
import { getAuthRuntimeConfig } from "./runtime";

let database: Database.Database | null = null;
let pgPool: Pool | null = null;

function isPostgresMode(): boolean {
  const runtime = getAuthRuntimeConfig();
  return runtime.databaseUrl?.startsWith("postgres") ?? false;
}

function ensureAuthDatabase() {
  const runtime = getAuthRuntimeConfig();
  if (database) {
    return database;
  }

  fs.mkdirSync(path.dirname(runtime.dbPath), { recursive: true });
  database = new Database(runtime.dbPath);
  database.pragma("journal_mode = WAL");
  return database;
}

export function getAuthDatabaseConfig(): Database.Database | Pool {
  if (isPostgresMode()) {
    const pool = getAuthPgPool();
    /* v8 ignore start -- defensive: getAuthPgPool always returns a non-null pool when isPostgresMode is true */
    if (!pool) {
      throw new Error("Postgres mode is on but the auth Pool is unavailable.");
    }
    /* v8 ignore stop */
    return pool;
  }
  return ensureAuthDatabase();
}

export function getAuthPgPool(): Pool | null {
  if (!isPostgresMode()) {
    return null;
  }
  if (pgPool) {
    return pgPool;
  }
  const runtime = getAuthRuntimeConfig();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by isPostgresMode() above
  pgPool = new Pool({ connectionString: runtime.databaseUrl! });
  return pgPool;
}

export function getAuthDatabase(): Database.Database | null {
  if (isPostgresMode()) {
    return null;
  }
  return ensureAuthDatabase();
}
