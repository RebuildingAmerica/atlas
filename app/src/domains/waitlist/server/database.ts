import "@tanstack/react-start/server-only";
import type Database from "better-sqlite3";
import type { Pool } from "pg";
import { getAuthDatabase, getAuthPgPool } from "@/domains/access/server/auth-db";

export type WaitlistValue = string | number | null;
export interface WaitlistConnection {
  lock: string;
  query<T>(sql: string, values?: WaitlistValue[]): Promise<T[]>;
}
export interface WaitlistDatabase {
  transaction<T>(work: (connection: WaitlistConnection) => Promise<T>): Promise<T>;
}
const sqliteQueues = new WeakMap<Database.Database, Promise<unknown>>();

/** Serializes SQLite transactions so concurrent invitations cannot duplicate grants. */
export function sqliteWaitlistDatabase(database: Database.Database): WaitlistDatabase {
  return {
    async transaction(work) {
      const prior = sqliteQueues.get(database) ?? Promise.resolve();
      const result = prior
        .catch(() => undefined)
        .then(async () => {
          database.exec("BEGIN IMMEDIATE");
          try {
            const result = await work({
              lock: "",
              query<T>(sql: string, values: WaitlistValue[] = []): Promise<T[]> {
                const statement = database.prepare(sql);
                if (statement.reader) return Promise.resolve(statement.all(...values) as T[]);
                statement.run(...values);
                return Promise.resolve([]);
              },
            });
            database.exec("COMMIT");
            return result;
          } catch (error) {
            database.exec("ROLLBACK");
            throw error;
          }
        });
      sqliteQueues.set(database, result);
      return result;
    },
  };
}

export function postgresWaitlistDatabase(pool: Pool): WaitlistDatabase {
  return {
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work({
          lock: " FOR UPDATE",
          async query<T>(sql: string, values: WaitlistValue[] = []): Promise<T[]> {
            let index = 0;
            const result = await client.query(
              sql.replace(/\?/g, () => `$${++index}`),
              values,
            );
            return result.rows as T[];
          },
        });
        await client.query("COMMIT");
        return result;
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
