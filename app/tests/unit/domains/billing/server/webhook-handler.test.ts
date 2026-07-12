import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import {
  buildResearchPassCheckoutCompletedEvent,
  readWorkspaceProduct,
} from "../../../../helpers/billing/webhook-handler-test-bed";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  ensureAuthReady: vi.fn(),
  getAuthDatabase: vi.fn<() => Database.Database | null>(),
  getAuthPgPool: vi.fn<() => unknown>(),
  getStripeWebhookSecret: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
  getAuthDatabase: mocks.getAuthDatabase,
  getAuthPgPool: mocks.getAuthPgPool,
}));
vi.mock("@/domains/billing/server/stripe-client", () => ({
  getStripeClient: () => ({
    checkout: {
      sessions: {
        retrieve: mocks.retrieveCheckoutSession,
      },
    },
    webhooks: {
      constructEvent: mocks.constructEvent,
    },
  }),
  getStripeWebhookSecret: mocks.getStripeWebhookSecret,
}));

describe("handleStripeWebhook", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);
    mocks.constructEvent.mockReset();
    mocks.ensureAuthReady.mockReset();
    mocks.getAuthDatabase.mockReset();
    mocks.getAuthPgPool.mockReset();
    mocks.getStripeWebhookSecret.mockReset();
    mocks.retrieveCheckoutSession.mockReset();
    mocks.getAuthDatabase.mockReturnValue(db);
    mocks.getAuthPgPool.mockReturnValue(null);
    mocks.getStripeWebhookSecret.mockReturnValue("whsec_test");
  });

  afterEach(() => {
    db.close();
  });

  async function deliverWebhook(event: Stripe.Event): Promise<Response> {
    mocks.constructEvent.mockReturnValue(event);

    const { handleStripeWebhook } = await import("@/domains/billing/server/webhook-handler");
    return handleStripeWebhook(
      new Request("https://atlas.test/api/stripe/webhook", {
        body: "{}",
        headers: { "stripe-signature": "sig_test" },
        method: "POST",
      }),
    );
  }

  it("stores a seven-day expiry for weekly Research Pass checkouts", async () => {
    const created = Date.parse("2026-07-01T00:00:00.000Z") / 1000;

    const response = await deliverWebhook(
      buildResearchPassCheckoutCompletedEvent({ created, interval: "weekly" }),
    );

    expect(response.status).toBe(200);
    expect(readWorkspaceProduct(db)).toEqual({
      expires_at: "2026-07-08T00:00:00.000Z",
      product: "atlas_research_pass",
      status: "active",
      stripe_event_at: "2026-07-01T00:00:00.000Z",
    });
  });

  it("stores a thirty-day expiry for 30-day Research Pass checkouts", async () => {
    const created = Date.parse("2026-07-01T00:00:00.000Z") / 1000;

    const response = await deliverWebhook(
      buildResearchPassCheckoutCompletedEvent({ created, interval: "once" }),
    );

    expect(response.status).toBe(200);
    expect(readWorkspaceProduct(db).expires_at).toBe("2026-07-31T00:00:00.000Z");
  });

  it("marks the purchase intent paid when checkout metadata includes it", async () => {
    const created = Date.parse("2026-07-01T00:00:00.000Z") / 1000;
    db.prepare(
      `INSERT INTO purchase_intents
         (id, user_id, workspace_id, product, interval, status, stripe_checkout_session_id, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "pi_123",
      "user_123",
      "org_research",
      "atlas_research_pass",
      "weekly",
      "checkout_created",
      "cs_research_pass",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      "2026-07-02T00:00:00.000Z",
    );

    const response = await deliverWebhook(
      buildResearchPassCheckoutCompletedEvent({
        created,
        interval: "weekly",
        purchaseIntentId: "pi_123",
      }),
    );

    const row = db.prepare("SELECT status FROM purchase_intents WHERE id = ?").get("pi_123") as
      { status: string } | undefined;
    expect(response.status).toBe(200);
    expect(row?.status).toBe("paid");
  });

  it("does not mark a purchase intent paid from a different checkout session", async () => {
    const created = Date.parse("2026-07-01T00:00:00.000Z") / 1000;
    db.prepare(
      `INSERT INTO purchase_intents
         (id, user_id, product, interval, status, stripe_checkout_session_id, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "pi_123",
      "user_123",
      "atlas_research_pass",
      "weekly",
      "checkout_created",
      "cs_expected",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      "2026-07-02T00:00:00.000Z",
    );

    const response = await deliverWebhook(
      buildResearchPassCheckoutCompletedEvent({
        created,
        interval: "weekly",
        purchaseIntentId: "pi_123",
      }),
    );

    const row = db.prepare("SELECT status FROM purchase_intents WHERE id = ?").get("pi_123") as
      { status: string } | undefined;
    expect(response.status).toBe(200);
    expect(row?.status).toBe("checkout_created");
  });

  it("reconciles a paid checkout session when webhook delivery lags", async () => {
    const created = Date.parse("2026-07-01T00:00:00.000Z") / 1000;
    db.prepare(
      `INSERT INTO purchase_intents
         (id, user_id, workspace_id, product, interval, status, stripe_checkout_session_id, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "pi_123",
      "user_123",
      "org_research",
      "atlas_research_pass",
      "weekly",
      "checkout_created",
      "cs_research_pass",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      "2026-07-02T00:00:00.000Z",
    );
    const event = buildResearchPassCheckoutCompletedEvent({
      created,
      interval: "weekly",
      purchaseIntentId: "pi_123",
    });
    mocks.retrieveCheckoutSession.mockResolvedValue({
      ...event.data.object,
      created,
      payment_status: "paid",
    });

    const { reconcilePaidCheckoutSession } =
      await import("@/domains/billing/server/webhook-handler");
    await expect(reconcilePaidCheckoutSession("cs_research_pass")).resolves.toBe(true);

    const row = db.prepare("SELECT status FROM purchase_intents WHERE id = ?").get("pi_123") as
      { status: string } | undefined;
    expect(readWorkspaceProduct(db)).toEqual({
      expires_at: "2026-07-08T00:00:00.000Z",
      product: "atlas_research_pass",
      status: "active",
      stripe_event_at: "2026-07-01T00:00:00.000Z",
    });
    expect(row?.status).toBe("paid");
  });

  it("leaves local state unchanged when checkout reconciliation is still unpaid", async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue({
      created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
      id: "cs_unpaid",
      metadata: {
        product: "atlas_research_pass",
        workspace_id: "org_research",
      },
      object: "checkout.session",
      payment_status: "unpaid",
    });

    const { reconcilePaidCheckoutSession } =
      await import("@/domains/billing/server/webhook-handler");
    await expect(reconcilePaidCheckoutSession("cs_unpaid")).resolves.toBe(false);

    const row = db.prepare("SELECT COUNT(*) AS count FROM workspace_products").get() as
      { count: number } | undefined;
    expect(row?.count).toBe(0);
  });
});
