import type Database from "better-sqlite3";
import type { Pool, QueryResult, QueryResultRow } from "pg";

/** One statement the subject sent, exactly as it was written for Postgres. */
export interface RecordedPgQuery {
  sql: string;
  values: readonly unknown[];
}

export interface SqlitePgPool {
  /** Hand this to whatever stands in for `getAuthPgPool()`. */
  pool: Pool;
  /** Every statement executed, in order, with its untranslated Postgres SQL. */
  queries: RecordedPgQuery[];
}

interface TranslatedStatement {
  sql: string;
  values: unknown[];
}

/**
 * Rewrites Postgres `$n` placeholders as the anonymous `?` placeholders
 * better-sqlite3 binds positionally.
 *
 * A `$n` may appear more than once in one statement -- the workspace product
 * status update reuses `$2` for both the SET and the event-ordering guard --
 * so each occurrence gets its own `?` and the matching value is repeated. That
 * keeps a mis-numbered placeholder a test failure rather than something the
 * translation quietly papers over.
 *
 * @param sql - The Postgres statement.
 * @param values - Values indexed by placeholder number.
 * @returns The SQLite statement and its positionally-ordered values.
 */
function translate(sql: string, values: readonly unknown[]): TranslatedStatement {
  const ordered: unknown[] = [];
  const translated = sql.replace(/\$(\d+)/g, (_match, digits: string) => {
    const index = Number(digits) - 1;
    if (index < 0 || index >= values.length) {
      throw new Error(
        `Postgres placeholder $${digits} has no value (received ${values.length} values).`,
      );
    }
    ordered.push(values[index]);
    return "?";
  });
  return { sql: translated, values: ordered };
}

/**
 * Builds a `pg.Pool` stand-in that executes real SQL against an in-memory
 * SQLite database.
 *
 * The Postgres branches of the billing server code were previously untestable:
 * every suite pinned `getAuthPgPool()` to `null`, so the production database
 * path never ran and only the SQLite fallback was covered. A pool that merely
 * records calls would not have fixed that -- it would only prove a query was
 * issued, not that it writes the right row. Because Atlas's Postgres and SQLite
 * schemas are structurally identical (they differ only in column types), the
 * Postgres statements can be run verbatim against SQLite, so a wrong `$n`
 * index, a wrong parameter order or a wrong column list surfaces as a failing
 * assertion on the stored row.
 *
 * @param db - An in-memory SQLite database with the Atlas migrations applied.
 * @returns The pool stand-in plus the log of statements it executed.
 */
export function createSqlitePgPool(db: Database.Database): SqlitePgPool {
  const queries: RecordedPgQuery[] = [];

  function query<Row extends QueryResultRow>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    queries.push({ sql, values });
    const statement = translate(sql, values);
    const prepared = db.prepare(statement.sql);

    if (prepared.reader) {
      const rows = prepared.all(...statement.values) as Row[];
      return Promise.resolve({
        command: "SELECT",
        fields: [],
        oid: 0,
        rowCount: rows.length,
        rows,
      });
    }

    const result = prepared.run(...statement.values);
    return Promise.resolve({
      command: "UPDATE",
      fields: [],
      oid: 0,
      rowCount: result.changes,
      rows: [],
    });
  }

  return { pool: { query } as unknown as Pool, queries };
}
