import type Database from "better-sqlite3";

export interface PurchaseIntentRowSeed {
  /** Defaults to a day ahead so the row counts as live. */
  expiresAt?: string;
  id: string;
  interval?: string;
  product?: string;
  status: string;
  stripeCheckoutSessionId?: string | null;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Seeds a purchase_intents row directly, for the states the public API cannot
 * produce -- an already-expired intent, or one parked at `checkout_created`
 * without walking the whole onboarding sequence first.
 *
 * @param db - The database under test.
 * @param seed - Row values; anything omitted takes a live-team-purchase default.
 */
export function insertPurchaseIntentRow(db: Database.Database, seed: PurchaseIntentRowSeed): void {
  const createdAt = "2026-07-01T00:00:00.000Z";
  db.prepare(
    `INSERT INTO purchase_intents
       (id, user_id, workspace_id, product, interval, status, stripe_checkout_session_id, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    seed.id,
    seed.userId,
    seed.workspaceId ?? null,
    seed.product ?? "atlas_team",
    seed.interval ?? "monthly",
    seed.status,
    seed.stripeCheckoutSessionId ?? null,
    createdAt,
    createdAt,
    seed.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  );
}
