import "@tanstack/react-start/server-only";

import type { NodeSavedSession, NodeSavedState } from "@atproto/oauth-client-node";
import { getAuthDatabase, getAuthPgPool } from "./auth";

export interface AtprotoOAuthAppState {
  flow?: "link" | "sign-in";
  requestedHandle: string;
  returnTo: string;
  userId?: string;
}

interface JsonStoreOptions {
  ttlMs: number;
}

interface JsonStore<Value> {
  del(key: string): Promise<void>;
  get(key: string): Promise<Value | undefined>;
  pruneExpired(): Promise<void>;
  set(key: string, value: Value): Promise<void>;
}

export interface AtprotoOAuthStores {
  appStateStore: JsonStore<AtprotoOAuthAppState>;
  sessionStore: JsonStore<NodeSavedSession>;
  stateStore: JsonStore<NodeSavedState>;
}

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const OAUTH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function createAtprotoOAuthStores(): AtprotoOAuthStores {
  return {
    appStateStore: createJsonStore<AtprotoOAuthAppState>("atproto_oauth_app_state", {
      ttlMs: OAUTH_STATE_TTL_MS,
    }),
    sessionStore: createJsonStore<NodeSavedSession>("atproto_oauth_session", {
      ttlMs: OAUTH_SESSION_TTL_MS,
    }),
    stateStore: createJsonStore<NodeSavedState>("atproto_oauth_state", {
      ttlMs: OAUTH_STATE_TTL_MS,
    }),
  };
}

export async function pruneAtprotoOAuthStores(
  stores: AtprotoOAuthStores = createAtprotoOAuthStores(),
): Promise<void> {
  await Promise.all([
    stores.stateStore.pruneExpired(),
    stores.sessionStore.pruneExpired(),
    stores.appStateStore.pruneExpired(),
  ]);
}

function createJsonStore<Value>(tableName: string, options: JsonStoreOptions): JsonStore<Value> {
  return {
    async del(key: string): Promise<void> {
      await ensureStoreTable(tableName);
      await deleteExpiredStoreRows(tableName, options.ttlMs);
      const pool = getAuthPgPool();
      if (pool) {
        await pool.query(`DELETE FROM ${tableName} WHERE key = $1`, [key]);
        return;
      }
      getSqliteAuthDatabase().prepare(`DELETE FROM ${tableName} WHERE key = ?`).run(key);
    },
    async get(key: string): Promise<Value | undefined> {
      await ensureStoreTable(tableName);
      await deleteExpiredStoreRows(tableName, options.ttlMs);
      const pool = getAuthPgPool();
      if (pool) {
        const result = await pool.query<{ value: Value }>(
          `SELECT value FROM ${tableName} WHERE key = $1`,
          [key],
        );
        return result.rows[0]?.value;
      }
      const row = getSqliteAuthDatabase()
        .prepare(`SELECT value FROM ${tableName} WHERE key = ?`)
        .get(key) as { value: string } | undefined;
      return row ? (JSON.parse(row.value) as Value) : undefined;
    },
    async set(key: string, value: Value): Promise<void> {
      await ensureStoreTable(tableName);
      await deleteExpiredStoreRows(tableName, options.ttlMs);
      const pool = getAuthPgPool();
      if (pool) {
        await pool.query(
          `INSERT INTO ${tableName} (key, value, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
          [key, value],
        );
        return;
      }
      getSqliteAuthDatabase()
        .prepare(
          `INSERT INTO ${tableName} (key, value, updated_at)
           VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        )
        .run(key, JSON.stringify(value));
    },
    async pruneExpired(): Promise<void> {
      await ensureStoreTable(tableName);
      await deleteExpiredStoreRows(tableName, options.ttlMs);
    },
  };
}

async function deleteExpiredStoreRows(tableName: string, ttlMs: number): Promise<void> {
  const pool = getAuthPgPool();
  if (pool) {
    await pool.query(`DELETE FROM ${tableName} WHERE updated_at < now() - $1::interval`, [
      `${Math.ceil(ttlMs / 1000)} seconds`,
    ]);
    return;
  }
  const cutoff = new Date(Date.now() - ttlMs).toISOString();
  getSqliteAuthDatabase().prepare(`DELETE FROM ${tableName} WHERE updated_at < ?`).run(cutoff);
}

async function ensureStoreTable(tableName: string): Promise<void> {
  const pool = getAuthPgPool();
  if (pool) {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${tableName} (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    );
    return;
  }
  getSqliteAuthDatabase()
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${tableName} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
    )
    .run();
}

function getSqliteAuthDatabase() {
  const database = getAuthDatabase();
  if (!database) {
    throw new Error("Auth database unavailable.");
  }
  return database;
}
