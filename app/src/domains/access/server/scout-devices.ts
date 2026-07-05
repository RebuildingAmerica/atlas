import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getAuthDatabase, getAuthPgPool } from "./auth";

export type ScoutUploadTarget = "public" | "workspace";

export interface ScoutDeviceRecord {
  id: string;
  userId: string;
  workerName: string;
  defaultUploadTarget: ScoutUploadTarget;
  workspaceId: string | null;
  searchKeyConfigured: boolean;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface ScoutDeviceRegistrationInput {
  id?: string | null;
  userId: string;
  workerName: string;
  defaultUploadTarget: ScoutUploadTarget;
  workspaceId: string | null;
  searchKeyConfigured?: boolean;
  now?: Date;
}

export interface ScoutDeviceRevocationInput {
  deviceId: string;
  userId: string;
  now?: Date;
}

interface StoredScoutDeviceRow {
  id: string;
  user_id: string;
  worker_name: string;
  default_upload_target: string;
  workspace_id: string | null;
  search_key_configured: boolean | number;
  created_at: Date | string;
  last_seen_at: Date | string;
  revoked_at: Date | string | null;
}

interface NormalizedScoutDeviceRegistration {
  id: string;
  userId: string;
  workerName: string;
  defaultUploadTarget: ScoutUploadTarget;
  workspaceId: string | null;
  searchKeyConfigured: boolean | null;
  now: string;
}

export class ScoutDeviceRevokedError extends Error {
  constructor(deviceId: string) {
    super(`Scout device ${deviceId} has been revoked.`);
    this.name = "ScoutDeviceRevokedError";
  }
}

class ScoutDeviceOwnershipError extends Error {
  constructor(deviceId: string) {
    super(`Scout device ${deviceId} belongs to a different user.`);
    this.name = "ScoutDeviceOwnershipError";
  }
}

function buildScoutDeviceId(): string {
  return `scout_${randomUUID()}`;
}

function normalizeStoredDate(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeSearchKeyConfigured(value: boolean | number): boolean {
  return typeof value === "boolean" ? value : value === 1;
}

function mapScoutDeviceRow(row: StoredScoutDeviceRow): ScoutDeviceRecord {
  const createdAt = normalizeStoredDate(row.created_at);
  const lastSeenAt = normalizeStoredDate(row.last_seen_at);
  if (!createdAt || !lastSeenAt) {
    throw new Error("Scout device row is missing required timestamps.");
  }

  if (row.default_upload_target !== "public" && row.default_upload_target !== "workspace") {
    throw new Error("Scout device row has an invalid upload target.");
  }

  return {
    createdAt,
    defaultUploadTarget: row.default_upload_target,
    id: row.id,
    lastSeenAt,
    revokedAt: normalizeStoredDate(row.revoked_at),
    searchKeyConfigured: normalizeSearchKeyConfigured(row.search_key_configured),
    userId: row.user_id,
    workerName: row.worker_name,
    workspaceId: row.workspace_id,
  };
}

function trimRequired(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required.`);
  }
  return trimmed;
}

function normalizeRegistrationInput(
  input: ScoutDeviceRegistrationInput,
): NormalizedScoutDeviceRegistration {
  return {
    defaultUploadTarget: input.defaultUploadTarget,
    id: input.id ? trimRequired(input.id, "Scout device id") : buildScoutDeviceId(),
    now: (input.now ?? new Date()).toISOString(),
    searchKeyConfigured: input.searchKeyConfigured ?? null,
    userId: trimRequired(input.userId, "Scout user id"),
    workerName: trimRequired(input.workerName, "Scout device name"),
    workspaceId: input.workspaceId?.trim() || null,
  };
}

function getSqliteDeviceById(db: Database.Database, deviceId: string): StoredScoutDeviceRow | null {
  return (
    (db.prepare("SELECT * FROM scout_devices WHERE id = ? LIMIT 1").get(deviceId) as
      StoredScoutDeviceRow | undefined) ?? null
  );
}

async function getPgDeviceById(
  pool: NonNullable<ReturnType<typeof getAuthPgPool>>,
  deviceId: string,
): Promise<StoredScoutDeviceRow | null> {
  const result = await pool.query<StoredScoutDeviceRow>(
    "SELECT * FROM scout_devices WHERE id = $1 LIMIT 1",
    [deviceId],
  );
  return result.rows[0] ?? null;
}

function updateSqliteDevice(
  db: Database.Database,
  input: NormalizedScoutDeviceRegistration,
  current: StoredScoutDeviceRow,
): ScoutDeviceRecord {
  const searchKeyConfigured =
    input.searchKeyConfigured ?? normalizeSearchKeyConfigured(current.search_key_configured);
  db.prepare(
    `UPDATE scout_devices
     SET worker_name = ?,
         default_upload_target = ?,
         workspace_id = ?,
         search_key_configured = ?,
         last_seen_at = ?
     WHERE id = ?`,
  ).run(
    input.workerName,
    input.defaultUploadTarget,
    input.workspaceId,
    searchKeyConfigured ? 1 : 0,
    input.now,
    current.id,
  );

  const row = getSqliteDeviceById(db, current.id);
  if (!row) {
    throw new Error("Scout device update did not return a stored row.");
  }
  return mapScoutDeviceRow(row);
}

async function updatePgDevice(
  pool: NonNullable<ReturnType<typeof getAuthPgPool>>,
  input: NormalizedScoutDeviceRegistration,
  current: StoredScoutDeviceRow,
): Promise<ScoutDeviceRecord> {
  const searchKeyConfigured =
    input.searchKeyConfigured ?? normalizeSearchKeyConfigured(current.search_key_configured);
  const result = await pool.query<StoredScoutDeviceRow>(
    `UPDATE scout_devices
     SET worker_name = $1,
         default_upload_target = $2,
         workspace_id = $3,
         search_key_configured = $4,
         last_seen_at = $5
     WHERE id = $6
     RETURNING *`,
    [
      input.workerName,
      input.defaultUploadTarget,
      input.workspaceId,
      searchKeyConfigured,
      input.now,
      current.id,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Scout device update did not return a stored row.");
  }
  return mapScoutDeviceRow(row);
}

function assertDeviceCanBeTouched(
  current: StoredScoutDeviceRow,
  input: NormalizedScoutDeviceRegistration,
): void {
  if (current.user_id !== input.userId) {
    throw new ScoutDeviceOwnershipError(input.id);
  }
  if (current.revoked_at !== null) {
    throw new ScoutDeviceRevokedError(input.id);
  }
}

/**
 * Creates or refreshes a Scout device enrollment for a browser-approved user.
 *
 * This record is what lets the account page show the actual host computer a
 * user trusted, and what makes revoke meaningful before Scout receives a new
 * API token.
 *
 * @param input - Worker metadata from the Scout CLI token exchange.
 */
export async function registerOrTouchScoutDevice(
  input: ScoutDeviceRegistrationInput,
): Promise<ScoutDeviceRecord> {
  const normalized = normalizeRegistrationInput(input);
  const pool = getAuthPgPool();
  if (pool) {
    const current = await getPgDeviceById(pool, normalized.id);
    if (current) {
      assertDeviceCanBeTouched(current, normalized);
      return await updatePgDevice(pool, normalized, current);
    }

    const result = await pool.query<StoredScoutDeviceRow>(
      `INSERT INTO scout_devices (
         id,
         user_id,
         worker_name,
         default_upload_target,
         workspace_id,
         search_key_configured,
         created_at,
         last_seen_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [
        normalized.id,
        normalized.userId,
        normalized.workerName,
        normalized.defaultUploadTarget,
        normalized.workspaceId,
        normalized.searchKeyConfigured ?? false,
        normalized.now,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Scout device insert did not return a stored row.");
    }
    return mapScoutDeviceRow(row);
  }

  const db = getAuthDatabase();
  if (!db) {
    throw new Error("Auth database unavailable in current mode");
  }

  const current = getSqliteDeviceById(db, normalized.id);
  if (current) {
    assertDeviceCanBeTouched(current, normalized);
    return updateSqliteDevice(db, normalized, current);
  }

  db.prepare(
    `INSERT INTO scout_devices (
       id,
       user_id,
       worker_name,
       default_upload_target,
       workspace_id,
       search_key_configured,
       created_at,
       last_seen_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    normalized.id,
    normalized.userId,
    normalized.workerName,
    normalized.defaultUploadTarget,
    normalized.workspaceId,
    normalized.searchKeyConfigured === true ? 1 : 0,
    normalized.now,
    normalized.now,
  );

  const row = getSqliteDeviceById(db, normalized.id);
  if (!row) {
    throw new Error("Scout device insert did not return a stored row.");
  }
  return mapScoutDeviceRow(row);
}

/**
 * Lists active Scout device enrollments for one Atlas user.
 *
 * @param userId - Better Auth user id that owns the devices.
 */
export async function listScoutDevicesForUser(userId: string): Promise<ScoutDeviceRecord[]> {
  const normalizedUserId = trimRequired(userId, "Scout user id");
  const pool = getAuthPgPool();
  if (pool) {
    const result = await pool.query<StoredScoutDeviceRow>(
      `SELECT * FROM scout_devices
       WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY last_seen_at DESC`,
      [normalizedUserId],
    );
    return result.rows.map(mapScoutDeviceRow);
  }

  const db = getAuthDatabase();
  if (!db) {
    throw new Error("Auth database unavailable in current mode");
  }

  const rows = db
    .prepare(
      `SELECT * FROM scout_devices
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY last_seen_at DESC`,
    )
    .all(normalizedUserId) as StoredScoutDeviceRow[];
  return rows.map(mapScoutDeviceRow);
}

/**
 * Revokes a Scout device enrollment owned by the current user.
 *
 * @param input - Device id, user id, and optional clock for deterministic tests.
 */
export async function revokeScoutDevice(input: ScoutDeviceRevocationInput): Promise<void> {
  const deviceId = trimRequired(input.deviceId, "Scout device id");
  const userId = trimRequired(input.userId, "Scout user id");
  const revokedAt = (input.now ?? new Date()).toISOString();
  const pool = getAuthPgPool();
  if (pool) {
    await pool.query(
      `UPDATE scout_devices
       SET revoked_at = $1
       WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL`,
      [revokedAt, deviceId, userId],
    );
    return;
  }

  const db = getAuthDatabase();
  if (!db) {
    throw new Error("Auth database unavailable in current mode");
  }

  db.prepare(
    `UPDATE scout_devices
     SET revoked_at = ?
     WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  ).run(revokedAt, deviceId, userId);
}
