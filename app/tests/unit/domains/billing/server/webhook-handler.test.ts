import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import {
  buildCheckoutCompletedEvent,
  buildResearchPassCheckoutCompletedEvent,
  buildSubscriptionEvent,
  readWorkspaceProduct,
  readWorkspaceProductStripeLinkage,
} from "../../../../helpers/billing/webhook-handler-test-bed";
import { createSqlitePgPool } from "../../../../helpers/sqlite-pg-pool";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  ensureAuthReady: vi.fn(),
  getAuthDatabase: vi.fn<() => Database.Database | null>(),
  getAuthPgPool: vi.fn<() => unknown>(),
  getFullOrganization: vi.fn(),
  getStripeWebhookSecret: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  updateOrganization: vi.fn(),
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
    mocks.getFullOrganization.mockReset();
    mocks.getStripeWebhookSecret.mockReset();
    mocks.retrieveCheckoutSession.mockReset();
    mocks.updateOrganization.mockReset();
    mocks.getAuthDatabase.mockReturnValue(db);
    mocks.getAuthPgPool.mockReturnValue(null);
    mocks.getStripeWebhookSecret.mockReturnValue("whsec_test");
    mocks.getFullOrganization.mockResolvedValue(null);
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        getFullOrganization: mocks.getFullOrganization,
        updateOrganization: mocks.updateOrganization,
      },
    });
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

  describe("signature verification", () => {
    it("rejects a request with no stripe-signature header", async () => {
      const { handleStripeWebhook } = await import("@/domains/billing/server/webhook-handler");

      const response = await handleStripeWebhook(
        new Request("https://atlas.test/api/stripe/webhook", { body: "{}", method: "POST" }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Missing stripe-signature" });
      expect(mocks.constructEvent).not.toHaveBeenCalled();
    });

    it("rejects a request whose signature does not verify", async () => {
      mocks.constructEvent.mockImplementation(() => {
        throw new Error("No signatures found matching the expected signature for payload");
      });
      const { handleStripeWebhook } = await import("@/domains/billing/server/webhook-handler");

      const response = await handleStripeWebhook(
        new Request("https://atlas.test/api/stripe/webhook", {
          body: '{"id":"evt_forged"}',
          headers: { "stripe-signature": "sig_forged" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Invalid signature" });
      const row = db.prepare("SELECT COUNT(*) AS count FROM workspace_products").get() as {
        count: number;
      };
      expect(row.count).toBe(0);
    });

    it("verifies the raw request body against the configured webhook secret", async () => {
      mocks.constructEvent.mockReturnValue(
        buildResearchPassCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          interval: "weekly",
        }),
      );
      const { handleStripeWebhook } = await import("@/domains/billing/server/webhook-handler");

      await handleStripeWebhook(
        new Request("https://atlas.test/api/stripe/webhook", {
          body: '{"id":"evt_research_pass"}',
          headers: { "stripe-signature": "sig_test" },
          method: "POST",
        }),
      );

      expect(mocks.constructEvent).toHaveBeenCalledWith(
        '{"id":"evt_research_pass"}',
        "sig_test",
        "whsec_test",
      );
    });
  });

  describe("checkout.session.completed", () => {
    it("ignores a session with no workspace or product metadata", async () => {
      const response = await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          metadata: { product: "atlas_pro" },
        }),
      );

      expect(response.status).toBe(200);
      const row = db.prepare("SELECT COUNT(*) AS count FROM workspace_products").get() as {
        count: number;
      };
      expect(row.count).toBe(0);
    });

    it("stores no expiry for a product that is not the Research Pass", async () => {
      await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
        }),
      );

      expect(readWorkspaceProduct(db, "org_pro")).toEqual({
        expires_at: null,
        product: "atlas_pro",
        status: "active",
        stripe_event_at: "2026-07-01T00:00:00.000Z",
      });
    });

    it("refuses a Research Pass checkout whose interval metadata is missing", async () => {
      await expect(
        deliverWebhook(
          buildCheckoutCompletedEvent({
            created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
            metadata: { product: "atlas_research_pass", workspace_id: "org_research" },
          }),
        ),
      ).rejects.toThrow("interval 'weekly' or 'once'");
    });

    it("refuses a Research Pass checkout whose interval metadata is unrecognised", async () => {
      await expect(
        deliverWebhook(
          buildCheckoutCompletedEvent({
            created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
            metadata: {
              interval: "monthly",
              product: "atlas_research_pass",
              workspace_id: "org_research",
            },
          }),
        ),
      ).rejects.toThrow("interval 'weekly' or 'once'");
    });

    it("reads the Stripe ids out of expanded customer and subscription objects", async () => {
      await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          customer: { id: "cus_expanded" },
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
          subscription: { id: "sub_expanded" },
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_pro")).toEqual({
        status: "active",
        stripe_customer_id: "cus_expanded",
        stripe_event_at: "2026-07-01T00:00:00.000Z",
        stripe_subscription_id: "sub_expanded",
      });
    });

    it("reads the Stripe ids out of bare customer and subscription id strings", async () => {
      await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          customer: "cus_string",
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
          subscription: "sub_string",
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_pro")).toMatchObject({
        stripe_customer_id: "cus_string",
        stripe_subscription_id: "sub_string",
      });
    });

    it("writes the Stripe customer id onto the workspace metadata", async () => {
      mocks.getFullOrganization.mockResolvedValue({
        id: "org_pro",
        metadata: JSON.stringify({ ssoPrimaryProviderId: null, workspaceType: "team" }),
      });

      await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          customer: "cus_meta",
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
        }),
      );

      expect(mocks.updateOrganization).toHaveBeenCalledTimes(1);
      const call = mocks.updateOrganization.mock.calls[0]?.[0] as {
        body: { data: { metadata: { stripeCustomerId: string; workspaceType: string } } };
      };
      expect(call.body.data.metadata.stripeCustomerId).toBe("cus_meta");
      expect(call.body.data.metadata.workspaceType).toBe("team");
    });

    it("skips the metadata write when the workspace no longer exists", async () => {
      mocks.getFullOrganization.mockResolvedValue(null);

      await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          customer: "cus_missing_org",
          metadata: { product: "atlas_pro", workspace_id: "org_gone" },
        }),
      );

      expect(mocks.updateOrganization).not.toHaveBeenCalled();
      expect(readWorkspaceProductStripeLinkage(db, "org_gone")?.stripe_customer_id).toBe(
        "cus_missing_org",
      );
    });

    it("does not touch Better Auth when the session carries no customer", async () => {
      await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
        }),
      );

      expect(mocks.ensureAuthReady).not.toHaveBeenCalled();
    });
  });

  describe("event ordering", () => {
    it("ignores a checkout event older than the stored state", async () => {
      await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-10T00:00:00.000Z") / 1000,
          customer: "cus_new",
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
        }),
      );

      await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          customer: "cus_stale",
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_pro")).toMatchObject({
        stripe_customer_id: "cus_new",
        stripe_event_at: "2026-07-10T00:00:00.000Z",
      });
    });

    it("ignores a subscription status change older than the stored state", async () => {
      await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-10T00:00:00.000Z") / 1000,
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
          status: "active",
          subscriptionId: "sub_order",
          type: "customer.subscription.created",
        }),
      );

      await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          status: "past_due",
          subscriptionId: "sub_order",
          type: "customer.subscription.updated",
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_pro")).toMatchObject({
        status: "active",
        stripe_event_at: "2026-07-10T00:00:00.000Z",
      });
    });
  });

  describe("customer.subscription.created", () => {
    it("creates the workspace product row from subscription metadata", async () => {
      const response = await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          customer: "cus_sub",
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
          status: "active",
          subscriptionId: "sub_created",
          type: "customer.subscription.created",
        }),
      );

      expect(response.status).toBe(200);
      expect(readWorkspaceProductStripeLinkage(db, "org_pro")).toEqual({
        status: "active",
        stripe_customer_id: "cus_sub",
        stripe_event_at: "2026-07-01T00:00:00.000Z",
        stripe_subscription_id: "sub_created",
      });
      expect(readWorkspaceProduct(db, "org_pro").expires_at).toBeNull();
    });

    it("reads the customer id out of an expanded customer object", async () => {
      await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          customer: { id: "cus_expanded_sub" },
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
          status: "active",
          type: "customer.subscription.created",
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_pro")?.stripe_customer_id).toBe(
        "cus_expanded_sub",
      );
    });

    it("stores a null customer id when the subscription carries no customer", async () => {
      await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
          status: "active",
          type: "customer.subscription.created",
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_pro")?.stripe_customer_id).toBeNull();
    });

    it("ignores a subscription with no workspace metadata", async () => {
      const response = await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          metadata: { product: "atlas_pro" },
          status: "active",
          type: "customer.subscription.created",
        }),
      );

      expect(response.status).toBe(200);
      const row = db.prepare("SELECT COUNT(*) AS count FROM workspace_products").get() as {
        count: number;
      };
      expect(row.count).toBe(0);
    });

    it("ignores a subscription with no product metadata", async () => {
      await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          metadata: { workspace_id: "org_pro" },
          status: "active",
          type: "customer.subscription.created",
        }),
      );

      const row = db.prepare("SELECT COUNT(*) AS count FROM workspace_products").get() as {
        count: number;
      };
      expect(row.count).toBe(0);
    });

    it.each([
      ["active", "active"],
      ["trialing", "active"],
      ["past_due", "past_due"],
      ["canceled", "cancelled"],
      ["unpaid", "cancelled"],
      ["incomplete", "incomplete"],
      ["incomplete_expired", "incomplete_expired"],
      ["paused", "paused"],
    ])("maps Stripe status %s onto Atlas status %s", async (stripeStatus, atlasStatus) => {
      await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
          status: stripeStatus,
          type: "customer.subscription.created",
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_pro")?.status).toBe(atlasStatus);
    });
  });

  describe("customer.subscription.updated", () => {
    it("moves the workspace product to past_due when Stripe reports a failed renewal", async () => {
      db.prepare(
        `INSERT INTO workspace_products
           (id, workspace_id, product, status, stripe_subscription_id, stripe_event_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("wp_1", "org_pro", "atlas_pro", "active", "sub_live", "2026-07-01T00:00:00.000Z");

      const response = await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-05T00:00:00.000Z") / 1000,
          status: "past_due",
          subscriptionId: "sub_live",
          type: "customer.subscription.updated",
        }),
      );

      expect(response.status).toBe(200);
      expect(readWorkspaceProductStripeLinkage(db, "org_pro")).toMatchObject({
        status: "past_due",
        stripe_event_at: "2026-07-05T00:00:00.000Z",
      });
    });

    it("restores an active status when a past_due subscription recovers", async () => {
      db.prepare(
        `INSERT INTO workspace_products
           (id, workspace_id, product, status, stripe_subscription_id, stripe_event_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("wp_1", "org_pro", "atlas_pro", "past_due", "sub_live", "2026-07-01T00:00:00.000Z");

      await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-05T00:00:00.000Z") / 1000,
          status: "active",
          subscriptionId: "sub_live",
          type: "customer.subscription.updated",
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_pro")?.status).toBe("active");
    });

    it("leaves other workspaces' subscriptions untouched", async () => {
      db.prepare(
        `INSERT INTO workspace_products
           (id, workspace_id, product, status, stripe_subscription_id, stripe_event_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("wp_1", "org_a", "atlas_pro", "active", "sub_a", "2026-07-01T00:00:00.000Z");
      db.prepare(
        `INSERT INTO workspace_products
           (id, workspace_id, product, status, stripe_subscription_id, stripe_event_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("wp_2", "org_b", "atlas_pro", "active", "sub_b", "2026-07-01T00:00:00.000Z");

      await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-05T00:00:00.000Z") / 1000,
          status: "canceled",
          subscriptionId: "sub_a",
          type: "customer.subscription.updated",
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_a")?.status).toBe("cancelled");
      expect(readWorkspaceProductStripeLinkage(db, "org_b")?.status).toBe("active");
    });
  });

  describe("customer.subscription.deleted", () => {
    it("cancels the workspace product regardless of the reported Stripe status", async () => {
      db.prepare(
        `INSERT INTO workspace_products
           (id, workspace_id, product, status, stripe_subscription_id, stripe_event_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("wp_1", "org_pro", "atlas_pro", "active", "sub_gone", "2026-07-01T00:00:00.000Z");

      const response = await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-05T00:00:00.000Z") / 1000,
          status: "active",
          subscriptionId: "sub_gone",
          type: "customer.subscription.deleted",
        }),
      );

      expect(response.status).toBe(200);
      expect(readWorkspaceProductStripeLinkage(db, "org_pro")).toMatchObject({
        status: "cancelled",
        stripe_event_at: "2026-07-05T00:00:00.000Z",
      });
    });
  });

  it("acknowledges an event type it does not handle without writing anything", async () => {
    const response = await deliverWebhook({
      created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
      data: { object: {} },
      id: "evt_other",
      object: "event",
      type: "invoice.paid",
    } as unknown as Stripe.Event);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    const row = db.prepare("SELECT COUNT(*) AS count FROM workspace_products").get() as {
      count: number;
    };
    expect(row.count).toBe(0);
  });

  describe("without any auth database", () => {
    it("refuses to upsert a workspace product", async () => {
      mocks.getAuthDatabase.mockReturnValue(null);

      await expect(
        deliverWebhook(
          buildCheckoutCompletedEvent({
            created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
            metadata: { product: "atlas_pro", workspace_id: "org_pro" },
          }),
        ),
      ).rejects.toThrow("Auth database unavailable in current mode");
    });

    it("refuses to update a subscription status", async () => {
      mocks.getAuthDatabase.mockReturnValue(null);

      await expect(
        deliverWebhook(
          buildSubscriptionEvent({
            created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
            status: "canceled",
            type: "customer.subscription.deleted",
          }),
        ),
      ).rejects.toThrow("Auth database unavailable in current mode");
    });
  });

  describe("on Postgres", () => {
    beforeEach(() => {
      mocks.getAuthPgPool.mockReturnValue(createSqlitePgPool(db).pool);
      // A Postgres deployment never reaches the better-sqlite3 fallback, so
      // pinning this to null proves the handler took the Postgres branch.
      mocks.getAuthDatabase.mockReturnValue(null);
    });

    it("stores the Research Pass expiry through the Postgres upsert", async () => {
      const response = await deliverWebhook(
        buildResearchPassCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          interval: "weekly",
        }),
      );

      expect(response.status).toBe(200);
      expect(readWorkspaceProduct(db)).toEqual({
        expires_at: "2026-07-08T00:00:00.000Z",
        product: "atlas_research_pass",
        status: "active",
        stripe_event_at: "2026-07-01T00:00:00.000Z",
      });
    });

    it("updates an existing row rather than inserting a duplicate", async () => {
      await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          customer: "cus_first",
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
        }),
      );
      await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-09T00:00:00.000Z") / 1000,
          customer: "cus_second",
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
        }),
      );

      const row = db.prepare("SELECT COUNT(*) AS count FROM workspace_products").get() as {
        count: number;
      };
      expect(row.count).toBe(1);
      expect(readWorkspaceProductStripeLinkage(db, "org_pro")).toMatchObject({
        stripe_customer_id: "cus_second",
        stripe_event_at: "2026-07-09T00:00:00.000Z",
      });
    });

    it("ignores an out-of-order checkout event", async () => {
      await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-10T00:00:00.000Z") / 1000,
          customer: "cus_new",
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
        }),
      );
      await deliverWebhook(
        buildCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          customer: "cus_stale",
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_pro")).toMatchObject({
        stripe_customer_id: "cus_new",
        stripe_event_at: "2026-07-10T00:00:00.000Z",
      });
    });

    it("creates a workspace product from a subscription event", async () => {
      await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          customer: "cus_sub",
          metadata: { product: "atlas_pro", workspace_id: "org_pro" },
          status: "trialing",
          subscriptionId: "sub_pg",
          type: "customer.subscription.created",
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_pro")).toEqual({
        status: "active",
        stripe_customer_id: "cus_sub",
        stripe_event_at: "2026-07-01T00:00:00.000Z",
        stripe_subscription_id: "sub_pg",
      });
    });

    it("cancels the workspace product when the subscription is deleted", async () => {
      db.prepare(
        `INSERT INTO workspace_products
           (id, workspace_id, product, status, stripe_subscription_id, stripe_event_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("wp_1", "org_pro", "atlas_pro", "active", "sub_pg", "2026-07-01T00:00:00.000Z");

      await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-05T00:00:00.000Z") / 1000,
          status: "canceled",
          subscriptionId: "sub_pg",
          type: "customer.subscription.deleted",
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_pro")).toMatchObject({
        status: "cancelled",
        stripe_event_at: "2026-07-05T00:00:00.000Z",
      });
    });

    it("ignores an out-of-order subscription status change", async () => {
      db.prepare(
        `INSERT INTO workspace_products
           (id, workspace_id, product, status, stripe_subscription_id, stripe_event_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("wp_1", "org_pro", "atlas_pro", "active", "sub_pg", "2026-07-10T00:00:00.000Z");

      await deliverWebhook(
        buildSubscriptionEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          status: "canceled",
          subscriptionId: "sub_pg",
          type: "customer.subscription.updated",
        }),
      );

      expect(readWorkspaceProductStripeLinkage(db, "org_pro")).toMatchObject({
        status: "active",
        stripe_event_at: "2026-07-10T00:00:00.000Z",
      });
    });

    it("marks the purchase intent paid through the Postgres update", async () => {
      db.prepare(
        `INSERT INTO purchase_intents
           (id, user_id, workspace_id, product, interval, status, stripe_checkout_session_id, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "pi_pg",
        "user_pg",
        "org_research",
        "atlas_research_pass",
        "weekly",
        "checkout_created",
        "cs_research_pass",
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
        "2026-07-02T00:00:00.000Z",
      );

      await deliverWebhook(
        buildResearchPassCheckoutCompletedEvent({
          created: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          interval: "weekly",
          purchaseIntentId: "pi_pg",
        }),
      );

      const row = db.prepare("SELECT status FROM purchase_intents WHERE id = ?").get("pi_pg") as {
        status: string;
      };
      expect(row.status).toBe("paid");
    });
  });
});
