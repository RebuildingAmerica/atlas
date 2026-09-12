import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import {
  buildSubscriptionEvent,
  readWorkspaceProduct,
  readWorkspaceProductStripeLinkage,
} from "../../../../helpers/billing/webhook-handler-test-bed";

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
});
