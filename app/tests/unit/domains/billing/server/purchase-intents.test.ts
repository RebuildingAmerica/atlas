import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";

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
});
