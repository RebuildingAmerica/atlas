import Database from "better-sqlite3";

/**
 * An in-memory account database holding one owner, their team workspace, a
 * paid and refunded purchase, and an unrelated second account.
 *
 * Only the columns the platform lookup reads are created; the names match the
 * Better Auth and Atlas billing tables exactly, quoting included.
 */
export function createLookupDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
      "emailVerified" INTEGER NOT NULL, "createdAt" TEXT NOT NULL
    );
    CREATE TABLE "organization" (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL);
    CREATE TABLE "member" (
      id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "userId" TEXT NOT NULL, role TEXT NOT NULL
    );
    CREATE TABLE workspace_products (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, product TEXT NOT NULL, status TEXT NOT NULL,
      granted_at TEXT NOT NULL, expires_at TEXT, purchase_intent_id TEXT, stripe_subscription_id TEXT
    );
    CREATE TABLE purchase_intents (
      id TEXT PRIMARY KEY, workspace_id TEXT, product TEXT NOT NULL, interval TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL, paid_at TEXT, revoked_at TEXT,
      revocation_reason TEXT
    );
    CREATE TABLE billing_adjustments (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, amount INTEGER NOT NULL,
      currency TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
    );

    INSERT INTO "user" VALUES
      ('user_dana', 'Dana@Example.org', 'Dana', 1, '2026-09-01T12:00:00.000Z'),
      ('user_other', 'other@example.org', 'Other', 0, '2026-09-02T12:00:00.000Z');
    INSERT INTO "organization" VALUES ('org_team', 'Reno Tenants', 'reno-tenants');
    INSERT INTO "member" VALUES
      ('m1', 'org_team', 'user_dana', 'owner'),
      ('m2', 'org_team', 'user_other', 'member');
    INSERT INTO workspace_products VALUES
      ('wp1', 'org_team', 'atlas_team', 'active', '2026-09-03T12:00:00.000Z', NULL, 'pi_1', 'sub_1');
    INSERT INTO purchase_intents VALUES
      ('pi_1', 'org_team', 'atlas_team', 'month', 'paid', '2026-09-03T11:00:00.000Z',
       '2026-09-03T11:05:00.000Z', NULL, NULL);
    INSERT INTO billing_adjustments VALUES
      ('adj_1', 'org_team', 400, 'usd', 'refund', 'Charged twice', '2026-09-04T12:00:00.000Z');
  `);
  return db;
}
