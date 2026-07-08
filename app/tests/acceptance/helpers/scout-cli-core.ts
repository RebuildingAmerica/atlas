import { rm } from "node:fs/promises";
import { expect } from "@playwright/test";

export interface ScoutSessionFile {
  access_token: string;
  atlas_url: string;
  default_upload_target: "public" | "workspace";
  user_email: string;
  user_id: string;
  worker_id: string;
  worker_name: string | null;
  workspace_id: string | null;
}

interface FileSystemError extends Error {
  code?: string;
}

const SCOUT_HOME_CLEANUP_RETRIES = 5;
const SCOUT_HOME_CLEANUP_RETRY_DELAY_MS = 100;

export function assertString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  return value;
}

export function assertNullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string or null.`);
  }
  return value;
}

export function parseScoutSession(payload: unknown, accessToken: string): ScoutSessionFile {
  if (!payload || typeof payload !== "object") {
    throw new Error("Scout session file must be an object.");
  }
  const record = payload as Record<string, unknown>;
  const target = assertString(record.default_upload_target, "default_upload_target");
  if (target !== "public" && target !== "workspace") {
    throw new Error("default_upload_target must be public or workspace.");
  }
  return {
    access_token: accessToken,
    atlas_url: assertString(record.atlas_url, "atlas_url"),
    default_upload_target: target,
    user_email: assertString(record.user_email, "user_email"),
    user_id: assertString(record.user_id, "user_id"),
    worker_id: assertString(record.worker_id, "worker_id"),
    worker_name: assertNullableString(record.worker_name, "worker_name"),
    workspace_id: assertNullableString(record.workspace_id, "workspace_id"),
  };
}

export function jsonHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetriableCleanupError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as FileSystemError).code;
  return code === "ENOTEMPTY" || code === "EBUSY" || code === "EPERM";
}

export async function removeScoutHome(homeDir: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= SCOUT_HOME_CLEANUP_RETRIES; attempt += 1) {
    try {
      await rm(homeDir, { force: true, recursive: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableCleanupError(error) || attempt === SCOUT_HOME_CLEANUP_RETRIES) {
        throw error;
      }
      await delay(SCOUT_HOME_CLEANUP_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError;
}

export async function expectJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  expect(response.ok, body).toBe(true);
  return JSON.parse(body) as T;
}
