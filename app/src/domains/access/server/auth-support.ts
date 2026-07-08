import type Database from "better-sqlite3";
import type { Pool } from "pg";
import { GOOGLE_WORKSPACE_ISSUER } from "../organization-sso";
import {
  ClientIdMetadataError,
  isClientIdMetadataDocumentUrl,
  resolveClientIdMetadataDocument,
} from "./client-id-metadata";
import { upsertCimdClientPg, upsertCimdClientSqlite } from "./cimd-sync";
import { getAuthDatabase, getAuthPgPool } from "./auth-db";
import { getCimdResolverOptions } from "./runtime";

interface StoredOAuthDeviceClientRow {
  disabled: boolean | number | null;
}

export const SCOUT_DEVICE_LOGIN_EXPIRES_IN = "30m";
export const SCOUT_DEVICE_LOGIN_INTERVAL = "5s";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isActiveOAuthDeviceClientRow(row: StoredOAuthDeviceClientRow | undefined): boolean {
  if (!row) {
    return false;
  }

  return row.disabled !== true && row.disabled !== 1;
}

async function materializeCimdDeviceClient(clientId: string): Promise<void> {
  if (!isClientIdMetadataDocumentUrl(clientId)) {
    return;
  }

  let document;
  try {
    document = await resolveClientIdMetadataDocument(clientId, getCimdResolverOptions());
  } catch (error) {
    if (error instanceof ClientIdMetadataError) {
      return;
    }
    throw error;
  }

  const pool = getAuthPgPool();
  if (pool) {
    await upsertCimdClientPg(pool, document);
    return;
  }

  const database = getAuthDatabase();
  if (!database) {
    throw new Error("OAuth device client validation requires an auth database.");
  }
  upsertCimdClientSqlite(database, document);
}

export async function isRegisteredOAuthDeviceClient(clientId: string): Promise<boolean> {
  const normalizedClientId = clientId.trim();
  if (!normalizedClientId) {
    return false;
  }

  await materializeCimdDeviceClient(normalizedClientId);

  const pool = getAuthPgPool();
  if (pool) {
    const result = await pool.query<StoredOAuthDeviceClientRow>(
      'select "disabled" from "oauthClient" where "clientId" = $1 limit 1',
      [normalizedClientId],
    );
    return isActiveOAuthDeviceClientRow(result.rows[0]);
  }

  const database = getAuthDatabase();
  if (!database) {
    throw new Error("OAuth device client validation requires an auth database.");
  }
  const row = database
    .prepare("select disabled from oauthClient where clientId = ? limit 1")
    .get(normalizedClientId) as StoredOAuthDeviceClientRow | undefined;
  return isActiveOAuthDeviceClientRow(row);
}

export async function enforceRequirePkceOnAllClients(
  database: Database.Database | null,
  pgPool: Pool | null,
): Promise<void> {
  if (pgPool) {
    await pgPool.query('update "oauthClient" set "requirePKCE" = true where "requirePKCE" = false');
    return;
  }

  /* v8 ignore start -- in sqlite mode (no pgPool) getAuthDatabase always returns a non-null instance */
  if (!database) {
    return;
  }
  /* v8 ignore stop */
  database.prepare(`update oauthClient set requirePKCE = 1 where requirePKCE = 0`).run();
}

export function buildAtlasTrustedOrigins(publicBaseUrl: string): string[] {
  return [
    publicBaseUrl,
    GOOGLE_WORKSPACE_ISSUER,
    "https://oauth2.googleapis.com",
    "https://openidconnect.googleapis.com",
    "https://www.googleapis.com",
  ];
}
