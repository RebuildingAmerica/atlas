import "@tanstack/react-start/server-only";

import { getAuthDatabase, getAuthPgPool } from "@/domains/access/server/auth";
import type { AtlasSelfServeProduct } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import type { PricingCheckoutInterval } from "@/domains/billing/checkout-intervals";

export type PurchaseIntentStatus =
  | "started"
  | "account_ready"
  | "workspace_ready"
  | "checkout_created"
  | "paid"
  | "cancelled"
  | "expired"
  | "failed";

export interface PurchaseIntentRecord {
  expiresAt: string;
  id: string;
  interval: PricingCheckoutInterval;
  product: AtlasSelfServeProduct;
  status: PurchaseIntentStatus;
  stripeCheckoutSessionId: string | null;
  userId: string;
  workspaceId: string | null;
}

interface PurchaseIntentRow {
  expires_at: string;
  id: string;
  interval: PricingCheckoutInterval;
  product: AtlasSelfServeProduct;
  status: PurchaseIntentStatus;
  stripe_checkout_session_id: string | null;
  user_id: string;
  workspace_id: string | null;
}

const ACTIVE_PURCHASE_STATUSES: readonly PurchaseIntentStatus[] = [
  "started",
  "account_ready",
  "workspace_ready",
];

const PURCHASE_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function expiresAtIso(): string {
  return new Date(Date.now() + PURCHASE_INTENT_TTL_MS).toISOString();
}

function toRecord(row: PurchaseIntentRow): PurchaseIntentRecord {
  return {
    expiresAt: row.expires_at,
    id: row.id,
    interval: row.interval,
    product: row.product,
    status: row.status,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
  };
}

function getActiveStatusList(): string {
  return ACTIVE_PURCHASE_STATUSES.map((status) => `'${status}'`).join(", ");
}

export async function ensurePurchaseIntent({
  interval,
  product,
  userId,
}: {
  interval: PricingCheckoutInterval;
  product: AtlasSelfServeProduct;
  userId: string;
}): Promise<PurchaseIntentRecord> {
  const pgPool = getAuthPgPool();
  const activeStatuses = getActiveStatusList();
  const now = nowIso();

  if (pgPool) {
    const existing = await pgPool.query<PurchaseIntentRow>(
      `SELECT id, user_id, workspace_id, product, interval, status, stripe_checkout_session_id, expires_at
       FROM purchase_intents
       WHERE user_id = $1
         AND product = $2
         AND interval = $3
         AND status IN (${activeStatuses})
         AND expires_at > $4
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId, product, interval, now],
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      return toRecord(existingRow);
    }

    const id = crypto.randomUUID();
    const createdAt = nowIso();
    const expiresAt = expiresAtIso();
    const inserted = await pgPool.query<PurchaseIntentRow>(
      `INSERT INTO purchase_intents
         (id, user_id, product, interval, status, created_at, updated_at, expires_at)
       VALUES ($1, $2, $3, $4, 'started', $5, $5, $6)
       RETURNING id, user_id, workspace_id, product, interval, status, stripe_checkout_session_id, expires_at`,
      [id, userId, product, interval, createdAt, expiresAt],
    );
    const insertedRow = inserted.rows[0];
    if (!insertedRow) {
      throw new Error("Atlas could not start purchase onboarding.");
    }
    return toRecord(insertedRow);
  }

  const db = getAuthDatabase();
  if (!db) {
    throw new Error("Auth database unavailable in current mode");
  }

  const existing = db
    .prepare(
      `SELECT id, user_id, workspace_id, product, interval, status, stripe_checkout_session_id, expires_at
       FROM purchase_intents
       WHERE user_id = ?
         AND product = ?
         AND interval = ?
         AND status IN (${activeStatuses})
         AND expires_at > ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(userId, product, interval, now) as PurchaseIntentRow | undefined;
  if (existing) {
    return toRecord(existing);
  }

  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = expiresAtIso();
  db.prepare(
    `INSERT INTO purchase_intents
       (id, user_id, product, interval, status, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, 'started', ?, ?, ?)`,
  ).run(id, userId, product, interval, createdAt, createdAt, expiresAt);

  return {
    expiresAt,
    id,
    interval,
    product,
    status: "started",
    stripeCheckoutSessionId: null,
    userId,
    workspaceId: null,
  };
}

export async function loadPurchaseIntent({
  id,
  userId,
}: {
  id: string;
  userId: string;
}): Promise<PurchaseIntentRecord | null> {
  const pgPool = getAuthPgPool();
  if (pgPool) {
    const result = await pgPool.query<PurchaseIntentRow>(
      `SELECT id, user_id, workspace_id, product, interval, status, stripe_checkout_session_id, expires_at
       FROM purchase_intents
       WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  const db = getAuthDatabase();
  if (!db) {
    throw new Error("Auth database unavailable in current mode");
  }
  const row = db
    .prepare(
      `SELECT id, user_id, workspace_id, product, interval, status, stripe_checkout_session_id, expires_at
       FROM purchase_intents
       WHERE id = ? AND user_id = ?`,
    )
    .get(id, userId) as PurchaseIntentRow | undefined;
  return row ? toRecord(row) : null;
}

export async function attachWorkspaceToPurchaseIntent({
  id,
  userId,
  workspaceId,
}: {
  id: string;
  userId: string;
  workspaceId: string;
}): Promise<PurchaseIntentRecord> {
  return updatePurchaseIntent({
    id,
    userId,
    set: "workspace_id = ?, status = 'workspace_ready'",
    values: [workspaceId],
  });
}

export async function markPurchaseCheckoutCreated({
  id,
  stripeCheckoutSessionId,
  userId,
}: {
  id: string;
  stripeCheckoutSessionId: string;
  userId: string;
}): Promise<PurchaseIntentRecord> {
  return updatePurchaseIntent({
    id,
    userId,
    set: "stripe_checkout_session_id = ?, status = 'checkout_created'",
    values: [stripeCheckoutSessionId],
  });
}

export async function markPurchaseIntentPaid({
  id,
  product,
  stripeCheckoutSessionId,
  workspaceId,
}: {
  id: string;
  product: string;
  stripeCheckoutSessionId: string;
  workspaceId: string;
}): Promise<void> {
  const pgPool = getAuthPgPool();
  const updatedAt = nowIso();
  if (pgPool) {
    await pgPool.query(
      `UPDATE purchase_intents
       SET status = 'paid', updated_at = $1
       WHERE id = $2
         AND product = $3
         AND workspace_id = $4
         AND stripe_checkout_session_id = $5
         AND status = 'checkout_created'`,
      [updatedAt, id, product, workspaceId, stripeCheckoutSessionId],
    );
    return;
  }

  const db = getAuthDatabase();
  if (!db) {
    throw new Error("Auth database unavailable in current mode");
  }
  db.prepare(
    `UPDATE purchase_intents
     SET status = 'paid', updated_at = ?
     WHERE id = ?
       AND product = ?
       AND workspace_id = ?
       AND stripe_checkout_session_id = ?
       AND status = 'checkout_created'`,
  ).run(updatedAt, id, product, workspaceId, stripeCheckoutSessionId);
}

async function updatePurchaseIntent({
  id,
  set,
  userId,
  values,
}: {
  id: string;
  set: string;
  userId: string;
  values: readonly string[];
}): Promise<PurchaseIntentRecord> {
  const pgPool = getAuthPgPool();
  const updatedAt = nowIso();
  if (pgPool) {
    let parameterIndex = 1;
    const pgSet = set.replace(/\?/g, () => `$${parameterIndex++}`);
    const result = await pgPool.query<PurchaseIntentRow>(
      `UPDATE purchase_intents
       SET ${pgSet}, updated_at = $${values.length + 1}
       WHERE id = $${values.length + 2} AND user_id = $${values.length + 3}
       RETURNING id, user_id, workspace_id, product, interval, status, stripe_checkout_session_id, expires_at`,
      [...values, updatedAt, id, userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Atlas could not find that purchase.");
    }
    return toRecord(row);
  }

  const db = getAuthDatabase();
  if (!db) {
    throw new Error("Auth database unavailable in current mode");
  }
  db.prepare(
    `UPDATE purchase_intents
     SET ${set}, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(...values, updatedAt, id, userId);
  const updated = db
    .prepare(
      `SELECT id, user_id, workspace_id, product, interval, status, stripe_checkout_session_id, expires_at
       FROM purchase_intents
       WHERE id = ? AND user_id = ?`,
    )
    .get(id, userId) as PurchaseIntentRow | undefined;
  if (!updated) {
    throw new Error("Atlas could not find that purchase.");
  }
  return toRecord(updated);
}
