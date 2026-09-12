import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import {
  buildCheckoutCompletedEvent,
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
});
