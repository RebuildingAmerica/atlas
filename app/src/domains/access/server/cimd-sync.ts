import "@tanstack/react-start/server-only";

import type Database from "better-sqlite3";
import type { Pool } from "pg";

import type { ClientIdMetadataDocument } from "./client-id-metadata";

/**
 * Upserts a Better Auth `oauthClient` row from a validated CIMD document.
 *
 * The synthetic row is keyed by the document URL (which is also the OAuth
 * `client_id`).  Each authorize/token roundtrip refreshes the row so changes
 * to the document — for example a new `redirect_uri` — propagate without a
 * separate registration step.
 */

interface CimdRow {
  /** Stored as a JSON-encoded string per Better Auth's column convention. */
  redirectUris: string;
  /** Stored as a JSON-encoded string per Better Auth's column convention. */
  grantTypes: string;
  /** Stored as a JSON-encoded string per Better Auth's column convention. */
  responseTypes: string;
  clientId: string;
  name: string;
  uri: string | null;
  icon: string | null;
  policy: string | null;
  tos: string | null;
}

function toRow(document: ClientIdMetadataDocument): CimdRow {
  return {
    clientId: document.client_id,
    name: document.client_name,
    uri: document.client_uri ?? null,
    icon: document.logo_uri ?? null,
    policy: document.policy_uri ?? null,
    tos: document.tos_uri ?? null,
    redirectUris: JSON.stringify(document.redirect_uris),
    grantTypes: JSON.stringify(document.grant_types ?? ["authorization_code", "refresh_token"]),
    responseTypes: JSON.stringify(document.response_types ?? ["code"]),
  };
}

/**
 * Stable synthetic row id derived from the client_id URL so repeated upserts
 * touch the same row even on databases that don't auto-generate primary keys.
 */
function deriveRowId(clientId: string): string {
  return `cimd_${Buffer.from(clientId).toString("base64url")}`;
}

/**
 * Upserts the synthetic oauthClient row in the SQLite-backed Better Auth
 * database.
 */
export function upsertCimdClientSqlite(
  database: Database.Database,
  document: ClientIdMetadataDocument,
): void {
  const row = toRow(document);
  const id = deriveRowId(row.clientId);
  const now = new Date().toISOString();

  // Better Auth uses TEXT primary keys with no auto-generation, so SQLite's
  // `INSERT … ON CONFLICT` must be scoped to the unique `clientId` column.
  database
    .prepare(
      `INSERT INTO oauthClient
        (id, clientId, name, uri, icon, policy, tos, redirectUris, grantTypes,
         responseTypes, public, requirePKCE, tokenEndpointAuthMethod, disabled,
         createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'none', 0, ?, ?)
       ON CONFLICT(clientId) DO UPDATE SET
         name = excluded.name,
         uri = excluded.uri,
         icon = excluded.icon,
         policy = excluded.policy,
         tos = excluded.tos,
         redirectUris = excluded.redirectUris,
         grantTypes = excluded.grantTypes,
         responseTypes = excluded.responseTypes,
         public = 1,
         requirePKCE = 1,
         tokenEndpointAuthMethod = 'none',
         disabled = 0,
         updatedAt = excluded.updatedAt`,
    )
    .run(
      id,
      row.clientId,
      row.name,
      row.uri,
      row.icon,
      row.policy,
      row.tos,
      row.redirectUris,
      row.grantTypes,
      row.responseTypes,
      now,
      now,
    );
}

/**
 * Upserts the synthetic oauthClient row in the PostgreSQL-backed Better Auth
 * database.
 */
export async function upsertCimdClientPg(
  pool: Pool,
  document: ClientIdMetadataDocument,
): Promise<void> {
  const row = toRow(document);
  const id = deriveRowId(row.clientId);
  const now = new Date();

  await pool.query(
    `INSERT INTO "oauthClient"
       ("id", "clientId", "name", "uri", "icon", "policy", "tos",
        "redirectUris", "grantTypes", "responseTypes", "public", "requirePKCE",
        "tokenEndpointAuthMethod", "disabled", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, true, 'none', false, $11, $12)
     ON CONFLICT ("clientId") DO UPDATE SET
        "name" = EXCLUDED."name",
        "uri" = EXCLUDED."uri",
        "icon" = EXCLUDED."icon",
        "policy" = EXCLUDED."policy",
        "tos" = EXCLUDED."tos",
        "redirectUris" = EXCLUDED."redirectUris",
        "grantTypes" = EXCLUDED."grantTypes",
        "responseTypes" = EXCLUDED."responseTypes",
        "public" = true,
        "requirePKCE" = true,
        "tokenEndpointAuthMethod" = 'none',
        "disabled" = false,
        "updatedAt" = EXCLUDED."updatedAt"`,
    [
      id,
      row.clientId,
      row.name,
      row.uri,
      row.icon,
      row.policy,
      row.tos,
      row.redirectUris,
      row.grantTypes,
      row.responseTypes,
      now,
      now,
    ],
  );
}
