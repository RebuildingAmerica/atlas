import Database from "better-sqlite3";

/**
 * The Better Auth `oauthClient` columns Atlas writes to, mirrored from the
 * shape `atlas-migrations` leaves behind. Kept here so the CIMD suites can
 * exercise the real SQL against a real SQLite engine instead of asserting on
 * statement strings.
 */
const OAUTH_CLIENT_TABLE = `
CREATE TABLE "oauthClient" (
  "id" text not null primary key,
  "clientId" text not null unique,
  "clientSecret" text,
  "disabled" integer,
  "skipConsent" integer,
  "scopes" json,
  "userId" text,
  "createdAt" date,
  "updatedAt" date,
  "name" text,
  "uri" text,
  "icon" text,
  "contacts" json,
  "tos" text,
  "policy" text,
  "redirectUris" json not null,
  "tokenEndpointAuthMethod" text,
  "grantTypes" json,
  "responseTypes" json,
  "public" integer,
  "requirePKCE" integer
);
`;

/** A stored `oauthClient` row as SQLite hands it back. */
export interface StoredOAuthClientRow {
  id: string;
  clientId: string;
  disabled: number | null;
  name: string | null;
  uri: string | null;
  icon: string | null;
  policy: string | null;
  tos: string | null;
  redirectUris: string;
  grantTypes: string;
  responseTypes: string;
  tokenEndpointAuthMethod: string | null;
  public: number | null;
  requirePKCE: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Opens an in-memory auth database carrying the `oauthClient` table.
 *
 * @returns A database the caller is responsible for closing.
 */
export function createOAuthClientDatabase(): Database.Database {
  const database = new Database(":memory:");
  database.exec(OAUTH_CLIENT_TABLE);
  return database;
}

/**
 * Reads back the synthetic client row for one `client_id`.
 *
 * @param database - The database `createOAuthClientDatabase` returned.
 * @param clientId - The OAuth client id (the CIMD document URL).
 */
export function readOAuthClientRow(
  database: Database.Database,
  clientId: string,
): StoredOAuthClientRow | undefined {
  return database.prepare('SELECT * FROM "oauthClient" WHERE "clientId" = ?').get(clientId) as
    StoredOAuthClientRow | undefined;
}
