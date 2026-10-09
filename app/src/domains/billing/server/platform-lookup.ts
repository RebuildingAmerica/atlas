import "@tanstack/react-start/server-only";

import { getAuthDatabase, getAuthPgPool } from "@/domains/access/server/auth";

/** The account an email names. */
export interface LookupAccount {
  created_at: string;
  email: string;
  email_verified: boolean;
  id: string;
  name: string;
}

/** One product a workspace holds, and where it came from. */
export interface LookupProduct {
  expires_at: string | null;
  granted_at: string;
  product: string;
  purchase_intent_id: string | null;
  status: string;
  stripe_subscription_id: string | null;
}

/** One checkout a workspace started, and how it ended. */
export interface LookupPurchase {
  created_at: string;
  id: string;
  interval: string;
  paid_at: string | null;
  product: string;
  revocation_reason: string | null;
  revoked_at: string | null;
  status: string;
}

/** One refund or other money movement recorded against a purchase. */
export interface LookupAdjustment {
  amount: number;
  created_at: string;
  currency: string;
  kind: string;
  reason: string;
}

export interface LookupMember {
  email: string;
  role: string;
}

/** A workspace with everything the operator needs to answer its owner. */
export interface LookupWorkspace {
  adjustments: LookupAdjustment[];
  id: string;
  members: LookupMember[];
  name: string;
  products: LookupProduct[];
  purchases: LookupPurchase[];
  slug: string;
}

/** What an email or workspace slug finds. */
export interface PlatformLookupResult {
  account: LookupAccount | null;
  workspaces: LookupWorkspace[];
}

type SqlValue = string | number;

interface AccountRow {
  createdAt: string | Date;
  email: string;
  emailVerified: boolean | number;
  id: string;
  name: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
}

interface ProductRow extends Omit<LookupProduct, "expires_at" | "granted_at"> {
  expires_at: string | Date | null;
  granted_at: string | Date;
}

interface PurchaseRow extends Omit<LookupPurchase, "created_at" | "paid_at" | "revoked_at"> {
  created_at: string | Date;
  paid_at: string | Date | null;
  revoked_at: string | Date | null;
}

interface AdjustmentRow extends Omit<LookupAdjustment, "created_at"> {
  created_at: string | Date;
}

const RECENT_LIMIT = 20;

/**
 * Runs one read against whichever database holds accounts.
 *
 * The statements are written for Postgres; SQLite takes the same text with
 * positional placeholders, since every `$n` here appears once and in order.
 */
async function rows<Row>(sql: string, values: readonly SqlValue[]): Promise<Row[]> {
  const pool = getAuthPgPool();
  if (pool) {
    return (await pool.query(sql, [...values])).rows as Row[];
  }
  const database = getAuthDatabase();
  if (!database) {
    throw new Error("No account database is configured.");
  }
  return database.prepare(sql.replace(/\$\d+/g, "?")).all(...values) as Row[];
}

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

function isoOrNull(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}

async function workspaceDetail(workspace: WorkspaceRow): Promise<LookupWorkspace> {
  const [members, products, purchases, adjustments] = await Promise.all([
    rows<LookupMember>(
      `SELECT u.email AS email, m.role AS role FROM "member" m
       JOIN "user" u ON u.id = m."userId"
       WHERE m."organizationId" = $1 ORDER BY u.email`,
      [workspace.id],
    ),
    rows<ProductRow>(
      `SELECT product, status, granted_at, expires_at, purchase_intent_id, stripe_subscription_id
       FROM workspace_products WHERE workspace_id = $1 ORDER BY granted_at DESC`,
      [workspace.id],
    ),
    rows<PurchaseRow>(
      `SELECT id, product, interval, status, created_at, paid_at, revoked_at, revocation_reason
       FROM purchase_intents WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [workspace.id, RECENT_LIMIT],
    ),
    rows<AdjustmentRow>(
      `SELECT amount, currency, kind, reason, created_at
       FROM billing_adjustments WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [workspace.id, RECENT_LIMIT],
    ),
  ]);
  return {
    ...workspace,
    adjustments: adjustments.map((row) => ({ ...row, created_at: iso(row.created_at) })),
    members,
    products: products.map((row) => ({
      ...row,
      expires_at: isoOrNull(row.expires_at),
      granted_at: iso(row.granted_at),
    })),
    purchases: purchases.map((row) => ({
      ...row,
      created_at: iso(row.created_at),
      paid_at: isoOrNull(row.paid_at),
      revoked_at: isoOrNull(row.revoked_at),
    })),
  };
}

/**
 * Finds an account by email, or a workspace by slug, with what each holds.
 *
 * Read-only: the platform operator uses it to answer "what does this person
 * have, and why?" without production SQL.
 *
 * @param query - An email address or a workspace slug.
 */
export async function lookupPlatformAccount(query: string): Promise<PlatformLookupResult> {
  const needle = query.trim().toLowerCase();
  if (!needle.includes("@")) {
    const workspaces = await rows<WorkspaceRow>(
      `SELECT id, name, slug FROM "organization" WHERE slug = $1`,
      [needle],
    );
    return { account: null, workspaces: await Promise.all(workspaces.map(workspaceDetail)) };
  }

  const [account] = await rows<AccountRow>(
    `SELECT id, email, name, "emailVerified", "createdAt" FROM "user" WHERE lower(email) = $1`,
    [needle],
  );
  if (!account) {
    return { account: null, workspaces: [] };
  }
  const workspaces = await rows<WorkspaceRow>(
    `SELECT o.id AS id, o.name AS name, o.slug AS slug FROM "member" m
     JOIN "organization" o ON o.id = m."organizationId"
     WHERE m."userId" = $1 ORDER BY o.name`,
    [account.id],
  );
  return {
    account: {
      created_at: iso(account.createdAt),
      email: account.email,
      email_verified: Boolean(account.emailVerified),
      id: account.id,
      name: account.name,
    },
    workspaces: await Promise.all(workspaces.map(workspaceDetail)),
  };
}
