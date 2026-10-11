import type Database from "better-sqlite3";
import { Pool } from "pg";
import { PostgresDialect, type PostgresPool } from "kysely";
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
// Only SQL configuration is shared. Kysely acquires a client for each query or
// transaction; resolving the pool here keeps every connection with its current
// request, even when a reusable auth engine serves overlapping visitors.
const requestPools: PostgresPool = {
  connect: () => getAuthPgPool().connect(),
  get options() {
    return getAuthPgPool().options;
  },
  // This facade owns no connections. runWorkerRequest closes the physical pools.
  end: () => Promise.resolve(),
};
const databaseConfig = {
  dialect: new PostgresDialect({ pool: requestPools }),
  type: "postgres" as const,
};
export function getAuthDatabaseConfig(): typeof databaseConfig {
  return databaseConfig;
}
export function getAuthDatabase(): Database.Database | null {
  return null;
}
