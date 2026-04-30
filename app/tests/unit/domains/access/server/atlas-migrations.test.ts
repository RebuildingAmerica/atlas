import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runAtlasCustomMigrations,
  runAtlasCustomMigrationsPg,
  type AtlasMigration,
} from "@/domains/access/server/atlas-migrations";

describe("atlas-migrations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
  });

  afterEach(() => {
    db.close();
  });

  it("creates the tracking table on first run", () => {
    runAtlasCustomMigrations(db, []);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_atlas_migrations'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("runs migrations in order", () => {
    const migrations: AtlasMigration[] = [
      { version: 1, name: "create_foo", sqlite: "CREATE TABLE foo (id TEXT PRIMARY KEY)" },
      { version: 2, name: "create_bar", sqlite: "CREATE TABLE bar (id TEXT PRIMARY KEY)" },
    ];
    runAtlasCustomMigrations(db, migrations);

    const fooExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foo'")
      .get();
    const barExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bar'")
      .get();
    expect(fooExists).toBeTruthy();
    expect(barExists).toBeTruthy();
  });

  it("skips already-run migrations", () => {
    const migrations: AtlasMigration[] = [
      { version: 1, name: "create_foo", sqlite: "CREATE TABLE foo (id TEXT PRIMARY KEY)" },
    ];
    runAtlasCustomMigrations(db, migrations);
    runAtlasCustomMigrations(db, migrations);
  });

  it("records applied migrations", () => {
    const migrations: AtlasMigration[] = [
      { version: 1, name: "create_foo", sqlite: "CREATE TABLE foo (id TEXT PRIMARY KEY)" },
    ];
    runAtlasCustomMigrations(db, migrations);
    const applied = db.prepare("SELECT version, name FROM _atlas_migrations").all() as {
      version: number;
      name: string;
    }[];
    expect(applied).toHaveLength(1);
    const firstApplied = applied[0];
    expect(firstApplied).toBeDefined();
    expect(firstApplied?.version).toBe(1);
    expect(firstApplied?.name).toBe("create_foo");
  });
});

describe("runAtlasCustomMigrationsPg", () => {
  type PgQueryArgs = readonly [string, unknown[]?];
  function buildPool(initial: { rows: { version: number }[] }) {
    const queries: PgQueryArgs[] = [];
    const clientCalls: PgQueryArgs[] = [];
    const released: string[] = [];

    const client = {
      query: vi.fn((...args: PgQueryArgs) => {
        clientCalls.push(args);
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(() => {
        released.push("released");
      }),
    };

    const pool = {
      query: vi.fn((...args: PgQueryArgs) => {
        queries.push(args);
        const sql = args[0];
        if (typeof sql === "string" && sql.startsWith("SELECT version")) {
          return Promise.resolve(initial);
        }
        return Promise.resolve({ rows: [] });
      }),
      connect: vi.fn(() => Promise.resolve(client)),
    };

    return { pool, client, queries, clientCalls, released };
  }

  it("creates the tracking table and applies pending migrations in order", async () => {
    const { pool, client, queries, clientCalls } = buildPool({ rows: [] });
    const migrations: AtlasMigration[] = [
      {
        version: 2,
        name: "later",
        sqlite: "CREATE TABLE later_sqlite (id INT)",
        pg: "CREATE TABLE later_pg (id INT)",
      },
      { version: 1, name: "earlier", sqlite: "CREATE TABLE earlier (id INT)" },
    ];

    await runAtlasCustomMigrationsPg(
      pool as unknown as Parameters<typeof runAtlasCustomMigrationsPg>[0],
      migrations,
    );

    expect(queries[0]?.[0]).toMatch(/CREATE TABLE IF NOT EXISTS _atlas_migrations/);
    expect(queries[1]?.[0]).toMatch(/SELECT version FROM _atlas_migrations/);
    expect(pool.connect).toHaveBeenCalledTimes(2);

    expect(client.query.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(client.query.mock.calls[1]?.[0]).toBe("CREATE TABLE earlier (id INT)");
    expect(client.query.mock.calls[2]?.[0]).toMatch(/INSERT INTO _atlas_migrations/);
    expect(client.query.mock.calls[2]?.[1]).toEqual([1, "earlier"]);
    expect(client.query.mock.calls[3]?.[0]).toBe("COMMIT");
    expect(client.query.mock.calls[5]?.[0]).toBe("CREATE TABLE later_pg (id INT)");
    expect(clientCalls.some((call) => call[0] === "ROLLBACK")).toBe(false);
  });

  it("rolls back and releases the connection when a migration throws", async () => {
    const { pool, client } = buildPool({ rows: [] });
    client.query.mockImplementation((sql: string) => {
      if (sql.startsWith("CREATE")) {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve({ rows: [] });
    });

    const migrations: AtlasMigration[] = [
      { version: 1, name: "explodes", sqlite: "CREATE TABLE x (id INT)" },
    ];

    await expect(
      runAtlasCustomMigrationsPg(
        pool as unknown as Parameters<typeof runAtlasCustomMigrationsPg>[0],
        migrations,
      ),
    ).rejects.toThrow(/boom/);
    const sqls = client.query.mock.calls.map((call) => call[0]);
    expect(sqls).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });

  it("skips already-applied migrations", async () => {
    const { pool, client } = buildPool({ rows: [{ version: 1 }] });
    const migrations: AtlasMigration[] = [
      { version: 1, name: "skipped", sqlite: "CREATE TABLE skip_me (id INT)" },
      { version: 2, name: "applied", sqlite: "CREATE TABLE apply_me (id INT)" },
    ];

    await runAtlasCustomMigrationsPg(
      pool as unknown as Parameters<typeof runAtlasCustomMigrationsPg>[0],
      migrations,
    );

    expect(pool.connect).toHaveBeenCalledTimes(1);
    const sqls = client.query.mock.calls.map((call) => call[0]);
    expect(sqls.some((sql) => sql.includes("apply_me"))).toBe(true);
    expect(sqls.some((sql) => sql.includes("skip_me"))).toBe(false);
  });
});
