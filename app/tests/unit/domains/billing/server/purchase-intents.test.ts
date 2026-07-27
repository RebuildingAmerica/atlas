import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import { createSqlitePgPool } from "../../../../helpers/sqlite-pg-pool";
import { insertPurchaseIntentRow } from "../../../../helpers/billing/purchase-intent-rows";

const mocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn<() => Database.Database | null>(),
  getAuthPgPool: vi.fn<() => unknown>(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => ({
  getAuthDatabase: mocks.getAuthDatabase,
  getAuthPgPool: mocks.getAuthPgPool,
}));

describe("purchase intent store", () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.resetModules();
    db = new Database(":memory:");
    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);
    mocks.getAuthDatabase.mockReturnValue(db);
    mocks.getAuthPgPool.mockReturnValue(null);
  });

  afterEach(() => {
    db.close();
  });

  it("creates and resumes an active purchase intent for the same user and plan", async () => {
    const { ensurePurchaseIntent } = await import("@/domains/billing/server/purchase-intents");

    const first = await ensurePurchaseIntent({
      interval: "monthly",
      product: "atlas_team",
      userId: "user_123",
    });
    const second = await ensurePurchaseIntent({
      interval: "monthly",
      product: "atlas_team",
      userId: "user_123",
    });

    expect(second.id).toBe(first.id);
    expect(second.status).toBe("started");
    expect(second.workspaceId).toBeNull();
  });

  it("attaches workspace and checkout state to a purchase intent", async () => {
    const { attachWorkspaceToPurchaseIntent, ensurePurchaseIntent, markPurchaseCheckoutCreated } =
      await import("@/domains/billing/server/purchase-intents");

    const intent = await ensurePurchaseIntent({
      interval: "yearly",
      product: "atlas_team",
      userId: "user_123",
    });

    await attachWorkspaceToPurchaseIntent({
      id: intent.id,
      userId: "user_123",
      workspaceId: "org_team",
    });
    const updated = await markPurchaseCheckoutCreated({
      id: intent.id,
      stripeCheckoutSessionId: "cs_123",
      userId: "user_123",
    });

    expect(updated).toMatchObject({
      id: intent.id,
      status: "checkout_created",
      stripeCheckoutSessionId: "cs_123",
      workspaceId: "org_team",
    });
  });

  it("does not resume purchase intents that already created checkout", async () => {
    const { attachWorkspaceToPurchaseIntent, ensurePurchaseIntent, markPurchaseCheckoutCreated } =
      await import("@/domains/billing/server/purchase-intents");

    const first = await ensurePurchaseIntent({
      interval: "yearly",
      product: "atlas_team",
      userId: "user_123",
    });
    await attachWorkspaceToPurchaseIntent({
      id: first.id,
      userId: "user_123",
      workspaceId: "org_team",
    });
    await markPurchaseCheckoutCreated({
      id: first.id,
      stripeCheckoutSessionId: "cs_123",
      userId: "user_123",
    });

    const second = await ensurePurchaseIntent({
      interval: "yearly",
      product: "atlas_team",
      userId: "user_123",
    });

    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("started");
    expect(second.stripeCheckoutSessionId).toBeNull();
  });

  it("starts a fresh intent rather than resuming an expired one", async () => {
    insertPurchaseIntentRow(db, {
      expiresAt: "2020-01-02T00:00:00.000Z",
      id: "pi_expired",
      status: "started",
      userId: "user_123",
    });
    const { ensurePurchaseIntent } = await import("@/domains/billing/server/purchase-intents");

    const intent = await ensurePurchaseIntent({
      interval: "monthly",
      product: "atlas_team",
      userId: "user_123",
    });

    expect(intent.id).not.toBe("pi_expired");
  });

  it("does not resume another user's purchase intent", async () => {
    const { ensurePurchaseIntent } = await import("@/domains/billing/server/purchase-intents");

    const mine = await ensurePurchaseIntent({
      interval: "monthly",
      product: "atlas_team",
      userId: "user_a",
    });
    const theirs = await ensurePurchaseIntent({
      interval: "monthly",
      product: "atlas_team",
      userId: "user_b",
    });

    expect(theirs.id).not.toBe(mine.id);
  });

  it("does not resume an intent for a different billing interval", async () => {
    const { ensurePurchaseIntent } = await import("@/domains/billing/server/purchase-intents");

    const monthly = await ensurePurchaseIntent({
      interval: "monthly",
      product: "atlas_team",
      userId: "user_123",
    });
    const yearly = await ensurePurchaseIntent({
      interval: "yearly",
      product: "atlas_team",
      userId: "user_123",
    });

    expect(yearly.id).not.toBe(monthly.id);
    expect(yearly.interval).toBe("yearly");
  });

  describe("loadPurchaseIntent", () => {
    it("returns the stored intent for its owner", async () => {
      const { ensurePurchaseIntent, loadPurchaseIntent } =
        await import("@/domains/billing/server/purchase-intents");
      const intent = await ensurePurchaseIntent({
        interval: "monthly",
        product: "atlas_team",
        userId: "user_123",
      });

      await expect(loadPurchaseIntent({ id: intent.id, userId: "user_123" })).resolves.toEqual(
        intent,
      );
    });

    it("returns null for a purchase belonging to someone else", async () => {
      const { ensurePurchaseIntent, loadPurchaseIntent } =
        await import("@/domains/billing/server/purchase-intents");
      const intent = await ensurePurchaseIntent({
        interval: "monthly",
        product: "atlas_team",
        userId: "user_123",
      });

      await expect(
        loadPurchaseIntent({ id: intent.id, userId: "user_intruder" }),
      ).resolves.toBeNull();
    });

    it("returns null for an id that does not exist", async () => {
      const { loadPurchaseIntent } = await import("@/domains/billing/server/purchase-intents");

      await expect(loadPurchaseIntent({ id: "pi_absent", userId: "user_123" })).resolves.toBeNull();
    });
  });

  describe("markPurchaseIntentPaid", () => {
    it("marks a checkout-created intent paid", async () => {
      insertPurchaseIntentRow(db, {
        id: "pi_paid",
        status: "checkout_created",
        stripeCheckoutSessionId: "cs_1",
        userId: "user_123",
        workspaceId: "org_team",
      });
      const { markPurchaseIntentPaid } = await import("@/domains/billing/server/purchase-intents");

      await markPurchaseIntentPaid({
        id: "pi_paid",
        product: "atlas_team",
        stripeCheckoutSessionId: "cs_1",
        workspaceId: "org_team",
      });

      const row = db.prepare("SELECT status FROM purchase_intents WHERE id = ?").get("pi_paid") as {
        status: string;
      };
      expect(row.status).toBe("paid");
    });

    it("leaves an intent belonging to a different workspace alone", async () => {
      insertPurchaseIntentRow(db, {
        id: "pi_other",
        status: "checkout_created",
        stripeCheckoutSessionId: "cs_1",
        userId: "user_123",
        workspaceId: "org_team",
      });
      const { markPurchaseIntentPaid } = await import("@/domains/billing/server/purchase-intents");

      await markPurchaseIntentPaid({
        id: "pi_other",
        product: "atlas_team",
        stripeCheckoutSessionId: "cs_1",
        workspaceId: "org_elsewhere",
      });

      const row = db
        .prepare("SELECT status FROM purchase_intents WHERE id = ?")
        .get("pi_other") as { status: string };
      expect(row.status).toBe("checkout_created");
    });
  });

  describe("when the purchase cannot be found", () => {
    it("refuses to attach a workspace to someone else's purchase", async () => {
      const { attachWorkspaceToPurchaseIntent, ensurePurchaseIntent } =
        await import("@/domains/billing/server/purchase-intents");
      const intent = await ensurePurchaseIntent({
        interval: "monthly",
        product: "atlas_team",
        userId: "user_123",
      });

      await expect(
        attachWorkspaceToPurchaseIntent({
          id: intent.id,
          userId: "user_intruder",
          workspaceId: "org_team",
        }),
      ).rejects.toThrow("Atlas could not find that purchase.");
    });

    it("leaves the purchase untouched when the caller is not its owner", async () => {
      const { attachWorkspaceToPurchaseIntent, ensurePurchaseIntent } =
        await import("@/domains/billing/server/purchase-intents");
      const intent = await ensurePurchaseIntent({
        interval: "monthly",
        product: "atlas_team",
        userId: "user_123",
      });

      await expect(
        attachWorkspaceToPurchaseIntent({
          id: intent.id,
          userId: "user_intruder",
          workspaceId: "org_team",
        }),
      ).rejects.toThrow();

      const row = db
        .prepare("SELECT status, workspace_id FROM purchase_intents WHERE id = ?")
        .get(intent.id) as { status: string; workspace_id: string | null };
      expect(row).toEqual({ status: "started", workspace_id: null });
    });
  });

  describe("without an auth database", () => {
    beforeEach(() => {
      mocks.getAuthDatabase.mockReturnValue(null);
    });

    it("refuses to start a purchase", async () => {
      const { ensurePurchaseIntent } = await import("@/domains/billing/server/purchase-intents");

      await expect(
        ensurePurchaseIntent({ interval: "monthly", product: "atlas_team", userId: "user_123" }),
      ).rejects.toThrow("Auth database unavailable in current mode");
    });

    it("refuses to load a purchase", async () => {
      const { loadPurchaseIntent } = await import("@/domains/billing/server/purchase-intents");

      await expect(loadPurchaseIntent({ id: "pi_1", userId: "user_123" })).rejects.toThrow(
        "Auth database unavailable in current mode",
      );
    });

    it("refuses to update a purchase", async () => {
      const { markPurchaseCheckoutCreated } =
        await import("@/domains/billing/server/purchase-intents");

      await expect(
        markPurchaseCheckoutCreated({
          id: "pi_1",
          stripeCheckoutSessionId: "cs_1",
          userId: "user_123",
        }),
      ).rejects.toThrow("Auth database unavailable in current mode");
    });

    it("refuses to mark a purchase paid", async () => {
      const { markPurchaseIntentPaid } = await import("@/domains/billing/server/purchase-intents");

      await expect(
        markPurchaseIntentPaid({
          id: "pi_1",
          product: "atlas_team",
          stripeCheckoutSessionId: "cs_1",
          workspaceId: "org_team",
        }),
      ).rejects.toThrow("Auth database unavailable in current mode");
    });
  });

  describe("on Postgres", () => {
    beforeEach(() => {
      mocks.getAuthPgPool.mockReturnValue(createSqlitePgPool(db).pool);
      // A Postgres deployment never reaches the better-sqlite3 fallback, so
      // pinning this to null proves each function took the Postgres branch.
      mocks.getAuthDatabase.mockReturnValue(null);
    });

    it("creates and resumes an active purchase intent", async () => {
      const { ensurePurchaseIntent } = await import("@/domains/billing/server/purchase-intents");

      const first = await ensurePurchaseIntent({
        interval: "monthly",
        product: "atlas_team",
        userId: "user_123",
      });
      const second = await ensurePurchaseIntent({
        interval: "monthly",
        product: "atlas_team",
        userId: "user_123",
      });

      expect(first).toMatchObject({
        interval: "monthly",
        product: "atlas_team",
        status: "started",
        stripeCheckoutSessionId: null,
        userId: "user_123",
        workspaceId: null,
      });
      expect(second.id).toBe(first.id);
    });

    it("starts a fresh intent rather than resuming an expired one", async () => {
      insertPurchaseIntentRow(db, {
        expiresAt: "2020-01-02T00:00:00.000Z",
        id: "pi_expired",
        status: "started",
        userId: "user_123",
      });
      const { ensurePurchaseIntent } = await import("@/domains/billing/server/purchase-intents");

      const intent = await ensurePurchaseIntent({
        interval: "monthly",
        product: "atlas_team",
        userId: "user_123",
      });

      expect(intent.id).not.toBe("pi_expired");
    });

    it("carries the workspace and checkout session through the update", async () => {
      const { attachWorkspaceToPurchaseIntent, ensurePurchaseIntent, markPurchaseCheckoutCreated } =
        await import("@/domains/billing/server/purchase-intents");
      const intent = await ensurePurchaseIntent({
        interval: "yearly",
        product: "atlas_team",
        userId: "user_123",
      });

      const attached = await attachWorkspaceToPurchaseIntent({
        id: intent.id,
        userId: "user_123",
        workspaceId: "org_team",
      });
      const created = await markPurchaseCheckoutCreated({
        id: intent.id,
        stripeCheckoutSessionId: "cs_pg",
        userId: "user_123",
      });

      expect(attached).toMatchObject({ status: "workspace_ready", workspaceId: "org_team" });
      expect(created).toMatchObject({
        status: "checkout_created",
        stripeCheckoutSessionId: "cs_pg",
        workspaceId: "org_team",
      });
    });

    it("loads a stored intent and rejects a foreign owner", async () => {
      const { ensurePurchaseIntent, loadPurchaseIntent } =
        await import("@/domains/billing/server/purchase-intents");
      const intent = await ensurePurchaseIntent({
        interval: "monthly",
        product: "atlas_team",
        userId: "user_123",
      });

      await expect(loadPurchaseIntent({ id: intent.id, userId: "user_123" })).resolves.toEqual(
        intent,
      );
      await expect(
        loadPurchaseIntent({ id: intent.id, userId: "user_intruder" }),
      ).resolves.toBeNull();
    });

    it("marks a checkout-created intent paid", async () => {
      insertPurchaseIntentRow(db, {
        id: "pi_pg_paid",
        status: "checkout_created",
        stripeCheckoutSessionId: "cs_pg",
        userId: "user_123",
        workspaceId: "org_team",
      });
      const { markPurchaseIntentPaid } = await import("@/domains/billing/server/purchase-intents");

      await markPurchaseIntentPaid({
        id: "pi_pg_paid",
        product: "atlas_team",
        stripeCheckoutSessionId: "cs_pg",
        workspaceId: "org_team",
      });

      const row = db
        .prepare("SELECT status FROM purchase_intents WHERE id = ?")
        .get("pi_pg_paid") as { status: string };
      expect(row.status).toBe("paid");
    });

    it("refuses to update a purchase the caller does not own", async () => {
      const { attachWorkspaceToPurchaseIntent, ensurePurchaseIntent } =
        await import("@/domains/billing/server/purchase-intents");
      const intent = await ensurePurchaseIntent({
        interval: "monthly",
        product: "atlas_team",
        userId: "user_123",
      });

      await expect(
        attachWorkspaceToPurchaseIntent({
          id: intent.id,
          userId: "user_intruder",
          workspaceId: "org_team",
        }),
      ).rejects.toThrow("Atlas could not find that purchase.");
    });

    it("reports a failure to start onboarding when the insert returns no row", async () => {
      mocks.getAuthPgPool.mockReturnValue({
        query: () => Promise.resolve({ rows: [] }),
      });
      const { ensurePurchaseIntent } = await import("@/domains/billing/server/purchase-intents");

      await expect(
        ensurePurchaseIntent({ interval: "monthly", product: "atlas_team", userId: "user_123" }),
      ).rejects.toThrow("Atlas could not start purchase onboarding.");
    });
  });
});
