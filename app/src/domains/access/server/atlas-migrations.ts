import "@tanstack/react-start/server-only";

import type Database from "better-sqlite3";
import type { Pool } from "pg";

export interface AtlasMigration {
  version: number;
  name: string;
  sqlite: string;
  pg?: string;
  sqlitePrecondition?: (db: Database.Database) => boolean;
}

interface SqliteTableNameRow {
  name: string;
}

const TRACKING_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS _atlas_migrations (
  version   INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)
`;

const TRACKING_TABLE_SQL_PG = `
CREATE TABLE IF NOT EXISTS _atlas_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
`;

const WORKSPACE_PRODUCTS_SQLITE = `
CREATE TABLE workspace_products (
    id                     TEXT PRIMARY KEY,
    workspace_id           TEXT NOT NULL,
    product                TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'active',
    granted_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at             TEXT,
    stripe_subscription_id TEXT,
    stripe_customer_id     TEXT,
    UNIQUE(workspace_id, product)
);
CREATE INDEX idx_workspace_products_workspace ON workspace_products(workspace_id);
`;

const WORKSPACE_PRODUCTS_PG = `
CREATE TABLE workspace_products (
    id                     TEXT PRIMARY KEY,
    workspace_id           TEXT NOT NULL,
    product                TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'active',
    granted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at             TIMESTAMPTZ,
    stripe_subscription_id TEXT,
    stripe_customer_id     TEXT,
    UNIQUE(workspace_id, product)
);
CREATE INDEX idx_workspace_products_workspace ON workspace_products(workspace_id);
`;

const ADD_EVENT_AT_SQLITE = `
ALTER TABLE workspace_products ADD COLUMN stripe_event_at TEXT;
`;

const ADD_EVENT_AT_PG = `
ALTER TABLE workspace_products ADD COLUMN stripe_event_at TIMESTAMPTZ;
`;

const SCOUT_DEVICES_SQLITE = `
CREATE TABLE scout_devices (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL,
    worker_name           TEXT NOT NULL,
    default_upload_target TEXT NOT NULL,
    workspace_id          TEXT,
    search_key_configured INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL,
    last_seen_at          TEXT NOT NULL,
    revoked_at            TEXT
);
CREATE INDEX idx_scout_devices_user ON scout_devices(user_id);
`;

const SCOUT_DEVICES_PG = `
CREATE TABLE scout_devices (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL,
    worker_name           TEXT NOT NULL,
    default_upload_target TEXT NOT NULL,
    workspace_id          TEXT,
    search_key_configured BOOLEAN NOT NULL DEFAULT false,
    created_at            TIMESTAMPTZ NOT NULL,
    last_seen_at          TIMESTAMPTZ NOT NULL,
    revoked_at            TIMESTAMPTZ
);
CREATE INDEX idx_scout_devices_user ON scout_devices(user_id);
`;

const REPAIR_OAUTH_ARRAY_COLUMNS_SQLITE = `
CREATE TEMP TABLE "oauthRefreshToken_atlas_v4_copy" AS SELECT
  "id", "token", "clientId", "sessionId", "userId", "referenceId", "expiresAt", "createdAt",
  "revoked", "authTime", "scopes"
FROM "oauthRefreshToken";
CREATE TEMP TABLE "oauthAccessToken_atlas_v4_copy" AS SELECT
  "id", "token", "clientId", "sessionId", "userId", "referenceId", "refreshId", "expiresAt",
  "createdAt", "scopes"
FROM "oauthAccessToken";
CREATE TEMP TABLE "oauthConsent_atlas_v4_copy" AS SELECT
  "id", "clientId", "userId", "referenceId", "scopes", "createdAt", "updatedAt"
FROM "oauthConsent";

CREATE TABLE "oauthClient_atlas_v4" (
    "id" text not null primary key,
    "clientId" text not null unique,
    "clientSecret" text,
    "disabled" integer,
    "skipConsent" integer,
    "enableEndSession" integer,
    "subjectType" text,
    "scopes" json,
    "userId" text references "user" ("id") on delete cascade,
    "createdAt" date,
    "updatedAt" date,
    "name" text,
    "uri" text,
    "icon" text,
    "contacts" json,
    "tos" text,
    "policy" text,
    "softwareId" text,
    "softwareVersion" text,
    "softwareStatement" text,
    "redirectUris" json not null,
    "postLogoutRedirectUris" json,
    "tokenEndpointAuthMethod" text,
    "grantTypes" json,
    "responseTypes" json,
    "public" integer,
    "type" text,
    "requirePKCE" integer,
    "referenceId" text,
    "metadata" text
);
INSERT INTO "oauthClient_atlas_v4"
  ("id", "clientId", "clientSecret", "disabled", "skipConsent", "enableEndSession", "subjectType",
   "scopes", "userId", "createdAt", "updatedAt", "name", "uri", "icon", "contacts", "tos",
   "policy", "softwareId", "softwareVersion", "softwareStatement", "redirectUris",
   "postLogoutRedirectUris", "tokenEndpointAuthMethod", "grantTypes", "responseTypes", "public",
   "type", "requirePKCE", "referenceId", "metadata")
SELECT
  "id", "clientId", "clientSecret", "disabled", "skipConsent", "enableEndSession", "subjectType",
  "scopes", "userId", "createdAt", "updatedAt", "name", "uri", "icon", "contacts", "tos",
  "policy", "softwareId", "softwareVersion", "softwareStatement", "redirectUris",
  "postLogoutRedirectUris", "tokenEndpointAuthMethod", "grantTypes", "responseTypes", "public",
  "type", "requirePKCE", "referenceId", "metadata"
FROM "oauthClient";
DROP TABLE "oauthConsent";
DROP TABLE "oauthAccessToken";
DROP TABLE "oauthRefreshToken";
DROP TABLE "oauthClient";
ALTER TABLE "oauthClient_atlas_v4" RENAME TO "oauthClient";

CREATE TABLE "oauthRefreshToken" (
    "id" text not null primary key,
    "token" text not null unique,
    "clientId" text not null references "oauthClient" ("clientId") on delete cascade,
    "sessionId" text references "session" ("id") on delete set null,
    "userId" text not null references "user" ("id") on delete cascade,
    "referenceId" text,
    "expiresAt" date not null,
    "createdAt" date not null,
    "revoked" date,
    "authTime" date,
    "scopes" json not null
);
INSERT INTO "oauthRefreshToken"
  ("id", "token", "clientId", "sessionId", "userId", "referenceId", "expiresAt", "createdAt",
   "revoked", "authTime", "scopes")
SELECT
  "id", "token", "clientId", "sessionId", "userId", "referenceId", "expiresAt", "createdAt",
  "revoked", "authTime", "scopes"
FROM "oauthRefreshToken_atlas_v4_copy";

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
    "scopes" json not null
);
INSERT INTO "oauthAccessToken"
  ("id", "token", "clientId", "sessionId", "userId", "referenceId", "refreshId", "expiresAt",
   "createdAt", "scopes")
SELECT
  "id", "token", "clientId", "sessionId", "userId", "referenceId", "refreshId", "expiresAt",
  "createdAt", "scopes"
FROM "oauthAccessToken_atlas_v4_copy";

CREATE TABLE "oauthConsent" (
    "id" text not null primary key,
    "clientId" text not null references "oauthClient" ("clientId") on delete cascade,
    "userId" text references "user" ("id") on delete cascade,
    "referenceId" text,
    "scopes" json not null,
    "createdAt" date not null,
    "updatedAt" date not null
);
INSERT INTO "oauthConsent"
  ("id", "clientId", "userId", "referenceId", "scopes", "createdAt", "updatedAt")
SELECT "id", "clientId", "userId", "referenceId", "scopes", "createdAt", "updatedAt"
FROM "oauthConsent_atlas_v4_copy";

DROP TABLE "oauthRefreshToken_atlas_v4_copy";
DROP TABLE "oauthAccessToken_atlas_v4_copy";
DROP TABLE "oauthConsent_atlas_v4_copy";
`;

const REPAIR_OAUTH_ARRAY_COLUMNS_PG = `
ALTER TABLE "oauthClient" ALTER COLUMN "scopes" TYPE jsonb USING "scopes"::jsonb;
ALTER TABLE "oauthClient" ALTER COLUMN "contacts" TYPE jsonb USING "contacts"::jsonb;
ALTER TABLE "oauthClient" ALTER COLUMN "redirectUris" TYPE jsonb USING "redirectUris"::jsonb;
ALTER TABLE "oauthClient" ALTER COLUMN "postLogoutRedirectUris" TYPE jsonb USING "postLogoutRedirectUris"::jsonb;
ALTER TABLE "oauthClient" ALTER COLUMN "grantTypes" TYPE jsonb USING "grantTypes"::jsonb;
ALTER TABLE "oauthClient" ALTER COLUMN "responseTypes" TYPE jsonb USING "responseTypes"::jsonb;
ALTER TABLE "oauthRefreshToken" ALTER COLUMN "scopes" TYPE jsonb USING "scopes"::jsonb;
ALTER TABLE "oauthAccessToken" ALTER COLUMN "scopes" TYPE jsonb USING "scopes"::jsonb;
ALTER TABLE "oauthConsent" ALTER COLUMN "scopes" TYPE jsonb USING "scopes"::jsonb;
`;

const SEED_ATLAS_SCOUT_OAUTH_CLIENT_SQLITE = `
INSERT INTO "oauthClient"
  ("id", "clientId", "disabled", "name", "redirectUris", "tokenEndpointAuthMethod",
   "grantTypes", "responseTypes", "public", "requirePKCE", "createdAt", "updatedAt")
VALUES
  ('atlas_scout_cli', 'atlas-scout-cli', 0, 'Atlas Scout', '[]', 'none',
   '["urn:ietf:params:oauth:grant-type:device_code"]', '[]', 1, 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT("clientId") DO UPDATE SET
  "name" = excluded."name",
  "redirectUris" = excluded."redirectUris",
  "tokenEndpointAuthMethod" = excluded."tokenEndpointAuthMethod",
  "grantTypes" = excluded."grantTypes",
  "responseTypes" = excluded."responseTypes",
  "public" = excluded."public",
  "requirePKCE" = excluded."requirePKCE",
  "updatedAt" = excluded."updatedAt";
`;

const SEED_ATLAS_SCOUT_OAUTH_CLIENT_PG = `
INSERT INTO "oauthClient"
  ("id", "clientId", "disabled", "name", "redirectUris", "tokenEndpointAuthMethod",
   "grantTypes", "responseTypes", "public", "requirePKCE", "createdAt", "updatedAt")
VALUES
  ('atlas_scout_cli', 'atlas-scout-cli', false, 'Atlas Scout', '[]'::jsonb, 'none',
   '["urn:ietf:params:oauth:grant-type:device_code"]'::jsonb, '[]'::jsonb, true, true,
   now(), now())
ON CONFLICT ("clientId") DO UPDATE SET
  "name" = EXCLUDED."name",
  "redirectUris" = EXCLUDED."redirectUris",
  "tokenEndpointAuthMethod" = EXCLUDED."tokenEndpointAuthMethod",
  "grantTypes" = EXCLUDED."grantTypes",
  "responseTypes" = EXCLUDED."responseTypes",
  "public" = EXCLUDED."public",
  "requirePKCE" = EXCLUDED."requirePKCE",
  "updatedAt" = EXCLUDED."updatedAt";
`;

function hasBetterAuthOAuthClientTable(db: Database.Database): boolean {
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name = 'oauthClient'
       LIMIT 1`,
    )
    .get() as SqliteTableNameRow | undefined;
  return Boolean(row);
}

function hasBetterAuthOAuthTables(db: Database.Database): boolean {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name IN ('oauthClient', 'oauthRefreshToken', 'oauthAccessToken', 'oauthConsent')`,
    )
    .all() as SqliteTableNameRow[];
  return rows.length === 4;
}

export const ATLAS_MIGRATIONS: AtlasMigration[] = [
  {
    version: 1,
    name: "create_workspace_products",
    sqlite: WORKSPACE_PRODUCTS_SQLITE,
    pg: WORKSPACE_PRODUCTS_PG,
  },
  {
    version: 2,
    name: "add_workspace_products_stripe_event_at",
    sqlite: ADD_EVENT_AT_SQLITE,
    pg: ADD_EVENT_AT_PG,
  },
  {
    version: 3,
    name: "create_scout_devices",
    sqlite: SCOUT_DEVICES_SQLITE,
    pg: SCOUT_DEVICES_PG,
  },
  {
    version: 4,
    name: "repair_better_auth_oauth_array_columns",
    sqlite: REPAIR_OAUTH_ARRAY_COLUMNS_SQLITE,
    pg: REPAIR_OAUTH_ARRAY_COLUMNS_PG,
    sqlitePrecondition: hasBetterAuthOAuthTables,
  },
  {
    version: 5,
    name: "seed_atlas_scout_oauth_client",
    sqlite: SEED_ATLAS_SCOUT_OAUTH_CLIENT_SQLITE,
    pg: SEED_ATLAS_SCOUT_OAUTH_CLIENT_PG,
    sqlitePrecondition: hasBetterAuthOAuthClientTable,
  },
];

/**
 * Runs pending Atlas custom migrations against a SQLite database.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param migrations - Ordered list of migrations to apply.
 */
export function runAtlasCustomMigrations(
  db: Database.Database,
  migrations: AtlasMigration[],
): void {
  db.exec(TRACKING_TABLE_SQL);

  const appliedRows = db.prepare("SELECT version FROM _atlas_migrations").all() as {
    version: number;
  }[];
  const applied = new Set(appliedRows.map((r) => r.version));

  const pending = migrations.filter((m) => !applied.has(m.version));
  const sorted = [...pending].sort((a, b) => a.version - b.version);

  for (const migration of sorted) {
    if (migration.sqlitePrecondition && !migration.sqlitePrecondition(db)) {
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sqlite);
      db.prepare("INSERT INTO _atlas_migrations (version, name) VALUES (?, ?)").run(
        migration.version,
        migration.name,
      );
    })();
  }
}

/**
 * Runs pending Atlas custom migrations against a PostgreSQL connection pool.
 *
 * @param pool - The pg Pool instance.
 * @param migrations - Ordered list of migrations to apply.
 */
export async function runAtlasCustomMigrationsPg(
  pool: Pool,
  migrations: AtlasMigration[],
): Promise<void> {
  await pool.query(TRACKING_TABLE_SQL_PG);

  const result = await pool.query("SELECT version FROM _atlas_migrations");
  const applied = new Set((result.rows as { version: number }[]).map((r) => r.version));

  const pending = migrations.filter((m) => !applied.has(m.version));
  const sorted = [...pending].sort((a, b) => a.version - b.version);

  for (const migration of sorted) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration.pg ?? migration.sqlite);
      await client.query("INSERT INTO _atlas_migrations (version, name) VALUES ($1, $2)", [
        migration.version,
        migration.name,
      ]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
