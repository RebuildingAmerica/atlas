import "@tanstack/react-start/server-only";
import type Database from "better-sqlite3";
import type { Pool } from "pg";
import { getAuthDatabase, getAuthPgPool } from "@/domains/access/server/auth-db";

export type WaitlistValue = string | number | null;
interface WaitlistStatement {
  sql: string;
  values: WaitlistValue[];
}
export type WaitlistTransaction<T> = Generator<WaitlistStatement, T, unknown>;
export interface WaitlistConnection {
  lock: string;
  query<T>(sql: string, values?: WaitlistValue[]): WaitlistTransaction<T[]>;
}
export interface WaitlistDatabase {
  transaction<T>(work: (connection: WaitlistConnection) => WaitlistTransaction<T>): Promise<T>;
}
function connection(lock: string): WaitlistConnection {
  return {
    lock,
    *query<T>(sql: string, values: WaitlistValue[] = []): WaitlistTransaction<T[]> {
      return (yield { sql, values }) as T[];
    },
  };
}

/** Keeps SQLite work synchronous so failed invitations cannot roll back auth or payment writes. */
export function sqliteWaitlistDatabase(database: Database.Database): WaitlistDatabase {
  return {
    transaction(work) {
      // The executor completes before returning, keeping other account writes outside this transaction.
      return new Promise((resolve) => {
        resolve(
          database
            .transaction(() => {
              const transaction = work(connection(""));
              let step = transaction.next();
              while (!step.done) {
                const statement = database.prepare(step.value.sql);
                let rows: unknown[] = [];
                if (statement.reader) rows = statement.all(...step.value.values);
                else statement.run(...step.value.values);
                step = transaction.next(rows);
              }
              return step.value;
            })
            .immediate(),
        );
      });
    },
  };
}

export function postgresWaitlistDatabase(pool: Pool): WaitlistDatabase {
  return {
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const transaction = work(connection(" FOR UPDATE"));
        let step = transaction.next();
        while (!step.done) {
          let index = 0;
          const result = await client.query(
            step.value.sql.replace(/\?/g, () => `$${++index}`),
            step.value.values,
          );
          step = transaction.next(result.rows);
        }
        await client.query("COMMIT");
        return step.value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export function getWaitlistDatabase(): WaitlistDatabase {
  const pool = getAuthPgPool();
  if (pool) return postgresWaitlistDatabase(pool);
  const database = getAuthDatabase();
  if (!database) throw new Error("Auth database unavailable.");
  return sqliteWaitlistDatabase(database);
}
