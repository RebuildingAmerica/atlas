import type Database from "better-sqlite3";
import { Pool } from "pg";
import { currentWorkerRequest, requestResource } from "./request-scope";

/** Hyperdrive pools upstream; Atlas owns only this request's client handles. */
export function getAuthPgPool(): Pool {
  const scope = currentWorkerRequest();
  if (!scope) throw new Error("Workers database access requires an active request.");
  const pool = requestResource("postgres", () => {
    const pool = new Pool({ connectionString: scope.connectionString, max: 1 });
    scope.cleanup.push(() => pool.end());
    return pool;
  });
  if (!pool) throw new Error("Workers request scope ended before database creation.");
  return pool;
}
export function getAuthDatabaseConfig(): Pool {
  return getAuthPgPool();
}
export function getAuthDatabase(): Database.Database | null {
  return null;
}
