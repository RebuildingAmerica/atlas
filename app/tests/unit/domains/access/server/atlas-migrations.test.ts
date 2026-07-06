import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
  runAtlasCustomMigrationsPg,
  type AtlasMigration,
} from "@/domains/access/server/atlas-migrations";

describe("atlas-migrations", () => {
  let db: Database.Database;

  function columnType(table: string, column: string): string | undefined {
    const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as {
      name: string;
      type: string;
    }[];
    return rows.find((row) => row.name === column)?.type.toLowerCase();
  }

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

  it("creates the Scout device registry in the bundled migration set", () => {
    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scout_devices'")
      .get();
    const userIndex = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_scout_devices_user'",
      )
      .get();

    expect(table).toBeTruthy();
    expect(userIndex).toBeTruthy();
  });

  it("seeds Scout as a first-party OAuth device client when Better Auth clients exist", () => {
    db.exec(`
      CREATE TABLE "oauthClient" (
        "id" text not null primary key,
        "clientId" text not null unique,
        "disabled" integer,
        "name" text,
        "redirectUris" json not null,
        "tokenEndpointAuthMethod" text,
        "grantTypes" json,
        "responseTypes" json,
        "public" integer,
        "requirePKCE" integer,
        "createdAt" date,
        "updatedAt" date
      );
    `);

    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);

    const client: unknown = db
      .prepare(
        `SELECT "clientId", "disabled", "name", "redirectUris", "tokenEndpointAuthMethod",
                "grantTypes", "responseTypes", "public", "requirePKCE"
         FROM "oauthClient" WHERE "clientId" = 'atlas-scout-cli'`,
      )
      .get();

    expect(client).toBeDefined();
    expect(client).toMatchObject({
      clientId: "atlas-scout-cli",
      disabled: 0,
      grantTypes: '["urn:ietf:params:oauth:grant-type:device_code"]',
      name: "Atlas Scout",
      public: 1,
      redirectUris: "[]",
      requirePKCE: 1,
      responseTypes: "[]",
      tokenEndpointAuthMethod: "none",
    });
  });

  it("repairs Better Auth OAuth array columns for SQLite drift checks", () => {
    db.exec(`
      CREATE TABLE "user" ("id" text not null primary key);
      CREATE TABLE "session" ("id" text not null primary key);
      CREATE TABLE "oauthClient" (
        "id" text not null primary key,
        "clientId" text not null unique,
        "clientSecret" text,
        "disabled" integer,
        "skipConsent" integer,
        "enableEndSession" integer,
        "subjectType" text,
        "scopes" text,
        "userId" text,
        "createdAt" date,
        "updatedAt" date,
        "name" text,
        "uri" text,
        "icon" text,
        "contacts" text,
        "tos" text,
        "policy" text,
        "softwareId" text,
        "softwareVersion" text,
        "softwareStatement" text,
        "redirectUris" text not null,
        "postLogoutRedirectUris" text,
        "tokenEndpointAuthMethod" text,
        "grantTypes" text,
        "responseTypes" text,
        "public" integer,
        "type" text,
        "requirePKCE" integer,
        "referenceId" text,
        "metadata" text
      );
      CREATE TABLE "oauthRefreshToken" (
        "id" text not null primary key,
        "token" text not null,
        "clientId" text not null,
        "sessionId" text,
        "userId" text not null,
        "referenceId" text,
        "expiresAt" date not null,
        "createdAt" date not null,
        "revoked" date,
        "authTime" date,
        "scopes" text not null
      );
      CREATE TABLE "oauthAccessToken" (
        "id" text not null primary key,
        "token" text not null unique,
        "clientId" text not null,
        "sessionId" text,
        "userId" text,
        "referenceId" text,
        "refreshId" text,
        "expiresAt" date not null,
        "createdAt" date not null,
        "scopes" text not null
      );
      CREATE TABLE "oauthConsent" (
        "id" text not null primary key,
        "clientId" text not null,
        "userId" text,
        "referenceId" text,
        "scopes" text not null,
        "createdAt" date not null,
        "updatedAt" date not null
      );
    `);

    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);

    expect(columnType("oauthClient", "scopes")).toBe("json");
    expect(columnType("oauthClient", "contacts")).toBe("json");
    expect(columnType("oauthClient", "redirectUris")).toBe("json");
    expect(columnType("oauthClient", "postLogoutRedirectUris")).toBe("json");
    expect(columnType("oauthClient", "grantTypes")).toBe("json");
    expect(columnType("oauthClient", "responseTypes")).toBe("json");
    expect(columnType("oauthRefreshToken", "scopes")).toBe("json");
    expect(columnType("oauthAccessToken", "scopes")).toBe("json");
    expect(columnType("oauthConsent", "scopes")).toBe("json");
  });

  it("preserves OAuth rows while repairing columns with SQLite foreign keys enabled", () => {
    db.exec(`
      CREATE TABLE "user" ("id" text not null primary key);
      CREATE TABLE "session" ("id" text not null primary key);
      CREATE TABLE "oauthClient" (
        "id" text not null primary key,
        "clientId" text not null unique,
        "clientSecret" text,
        "disabled" integer,
        "skipConsent" integer,
        "enableEndSession" integer,
        "subjectType" text,
        "scopes" text,
        "userId" text references "user" ("id") on delete cascade,
        "createdAt" date,
        "updatedAt" date,
        "name" text,
        "uri" text,
        "icon" text,
        "contacts" text,
        "tos" text,
        "policy" text,
        "softwareId" text,
        "softwareVersion" text,
        "softwareStatement" text,
        "redirectUris" text not null,
        "postLogoutRedirectUris" text,
        "tokenEndpointAuthMethod" text,
        "grantTypes" text,
        "responseTypes" text,
        "public" integer,
        "type" text,
        "requirePKCE" integer,
        "referenceId" text,
        "metadata" text
      );
      CREATE TABLE "oauthRefreshToken" (
        "id" text not null primary key,
        "token" text not null,
        "clientId" text not null references "oauthClient" ("clientId") on delete cascade,
        "sessionId" text references "session" ("id") on delete set null,
        "userId" text not null references "user" ("id") on delete cascade,
        "referenceId" text,
        "expiresAt" date not null,
        "createdAt" date not null,
        "revoked" date,
        "authTime" date,
        "scopes" text not null
      );
      CREATE TABLE "oauthAccessToken" (
        "id" text not null primary key,
        "token" text not null unique,
        "clientId" text not null references "oauthClient" ("clientId") on delete cascade,
        "sessionId" text references "session" ("id") on delete set null,
        "userId" text references "user" ("id") on delete cascade,
        "referenceId" text,
        "refreshId" text references "oauthRefreshToken" ("id") on delete cascade,
        "expiresAt" date not null,
        "createdAt" date not null,
        "scopes" text not null
      );
      CREATE TABLE "oauthConsent" (
        "id" text not null primary key,
        "clientId" text not null references "oauthClient" ("clientId") on delete cascade,
        "userId" text references "user" ("id") on delete cascade,
        "referenceId" text,
        "scopes" text not null,
        "createdAt" date not null,
        "updatedAt" date not null
      );
      INSERT INTO "user" ("id") VALUES ('user_1');
      INSERT INTO "session" ("id") VALUES ('session_1');
      INSERT INTO "oauthClient" (
        "id", "clientId", "scopes", "userId", "redirectUris", "contacts", "grantTypes",
        "responseTypes", "createdAt", "updatedAt"
      ) VALUES (
        'client_row_1', 'client_1', '["openid"]', 'user_1', '["https://client.test/callback"]',
        '["ops@client.test"]', '["authorization_code"]', '["code"]', '2026-01-01', '2026-01-01'
      );
      INSERT INTO "oauthRefreshToken" (
        "id", "token", "clientId", "sessionId", "userId", "expiresAt", "createdAt", "scopes"
      ) VALUES (
        'refresh_1', 'refresh-token', 'client_1', 'session_1', 'user_1', '2026-01-02',
        '2026-01-01', '["openid"]'
      );
      INSERT INTO "oauthAccessToken" (
        "id", "token", "clientId", "sessionId", "userId", "refreshId", "expiresAt", "createdAt",
        "scopes"
      ) VALUES (
        'access_1', 'access-token', 'client_1', 'session_1', 'user_1', 'refresh_1',
        '2026-01-02', '2026-01-01', '["openid"]'
      );
      INSERT INTO "oauthConsent" (
        "id", "clientId", "userId", "scopes", "createdAt", "updatedAt"
      ) VALUES (
        'consent_1', 'client_1', 'user_1', '["openid"]', '2026-01-01', '2026-01-01'
      );
    `);
    db.pragma("foreign_keys = ON");

    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);

    const client = db.prepare(`SELECT "redirectUris" FROM "oauthClient"`).get() as {
      redirectUris: string;
    };
    const refresh = db.prepare(`SELECT "clientId", "scopes" FROM "oauthRefreshToken"`).get() as {
      clientId: string;
      scopes: string;
    };
    expect(client.redirectUris).toBe('["https://client.test/callback"]');
    expect(refresh).toEqual({ clientId: "client_1", scopes: '["openid"]' });
    expect(db.pragma("foreign_key_check")).toEqual([]);
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
