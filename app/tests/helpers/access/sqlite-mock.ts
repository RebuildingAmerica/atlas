import { vi } from "vitest";

/**
 * Subset of better-sqlite3's `Statement` surface needed by the auth-server
 * tests. Matches the methods our production code actually invokes.
 */
export interface MockSqliteStatement {
  get: ReturnType<typeof vi.fn>;
}

/**
 * Subset of better-sqlite3's `Database` surface needed by the auth-server
 * tests.
 */
export interface MockSqliteDatabase {
  prepare: ReturnType<typeof vi.fn>;
}

/**
 * Builds a mock better-sqlite3 database whose only prepared statement returns
 * the provided row from `.get()`. Lets the tests assert on the read path
 * without spinning up a real database connection.
 *
 * @param row - The row value returned from the prepared statement's `.get()`.
 */
export function buildSqliteDatabaseReturning(row: unknown): MockSqliteDatabase {
  const statement: MockSqliteStatement = {
    get: vi.fn().mockReturnValue(row),
  };
  return { prepare: vi.fn().mockReturnValue(statement) };
}
