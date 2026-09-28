import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import { insertPurchaseIntentRow } from "../../../../helpers/billing/purchase-intent-rows";
import {
  buildRefundEvent,
  buildSubscriptionEvent,
} from "../../../../helpers/billing/webhook-handler-test-bed";
import { createSqlitePgPool } from "../../../../helpers/sqlite-pg-pool";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  getAuthDatabase: vi.fn<() => Database.Database | null>(),
  getAuthPgPool: vi.fn<() => unknown>(),
  retrieveCharge: vi.fn(),
  retrieveInvoice: vi.fn(),
  retrieveSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  listInvoicePayments: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => ({
  getAuthDatabase: mocks.getAuthDatabase,
  getAuthPgPool: mocks.getAuthPgPool,
}));
vi.mock("@/domains/billing/server/stripe-client", () => ({
  getStripeClient: () => ({
    charges: { retrieve: mocks.retrieveCharge },
    invoicePayments: { list: mocks.listInvoicePayments },
    invoices: { retrieve: mocks.retrieveInvoice },
    subscriptions: { retrieve: mocks.retrieveSubscription, cancel: mocks.cancelSubscription },
    webhooks: { constructEvent: mocks.constructEvent },
  }),
  getStripeWebhookSecret: () => "whsec_test",
}));

describe("refund webhook convergence", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getAuthDatabase.mockReturnValue(db);
    mocks.getAuthPgPool.mockReturnValue(null);
    mocks.retrieveCharge.mockResolvedValue({
      id: "ch_1",
      amount: 400,
      currency: "usd",
      payment_intent: "pi_stripe_1",
      paid: true,
    });
    insertPurchaseIntentRow(db, {
      id: "purchase_1",
      status: "paid",
      stripeCheckoutSessionId: "cs_1",
      userId: "buyer",
      workspaceId: "org_1",
      product: "atlas_research_pass",
      interval: "weekly",
    });
    db.prepare("UPDATE purchase_intents SET stripe_payment_intent_id = ? WHERE id = ?").run(
      "pi_stripe_1",
      "purchase_1",
    );
    db.prepare(
      `INSERT INTO workspace_products
       (id, workspace_id, product, status, purchase_intent_id, stripe_event_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "wp_1",
      "org_1",
      "atlas_research_pass",
      "active",
      "purchase_1",
      "2026-07-01T00:00:00.000Z",
    );
  });

  afterEach(() => db.close());

  async function deliver(event: Stripe.Event): Promise<Response> {
    mocks.constructEvent.mockReturnValue(event);
    const { handleStripeWebhook } = await import("@/domains/billing/server/webhook-handler");
    return handleStripeWebhook(
      new Request("https://atlas.test/api/stripe/webhook", {
        body: "{}",
        headers: { "stripe-signature": "sig" },
        method: "POST",
      }),
    );
  }

  function configureInvoiceAttribution(): void {
    db.prepare(
      `UPDATE purchase_intents SET product = 'atlas_team', stripe_payment_intent_id = NULL,
       stripe_subscription_id = 'sub_1' WHERE id = 'purchase_1'`,
    ).run();
    mocks.listInvoicePayments.mockResolvedValue({
      data: [{ invoice: "in_1", status: "paid" }],
      has_more: false,
    });
    mocks.retrieveInvoice.mockResolvedValue({
      id: "in_1",
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } },
    });
    mocks.retrieveSubscription.mockResolvedValue({
      id: "sub_1",
      latest_invoice: "in_1",
      status: "active",
    });
  }

  it("refuses ambiguous paid purchase references", async () => {
    insertPurchaseIntentRow(db, {
      id: "purchase_2",
      status: "paid",
      stripeCheckoutSessionId: "cs_2",
      userId: "buyer_2",
      workspaceId: "org_2",
      product: "atlas_research_pass",
      interval: "weekly",
    });
    db.prepare("UPDATE purchase_intents SET stripe_payment_intent_id = ? WHERE id = ?").run(
      "pi_stripe_1",
      "purchase_2",
    );
    const { resolveRefundPurchase } = await import("@/domains/billing/server/billing-adjustments");
    await expect(resolveRefundPurchase("pi_stripe_1")).rejects.toThrow("one paid purchase");
  });

  it("refuses a paid purchase without an assigned workspace", async () => {
    db.prepare("UPDATE purchase_intents SET workspace_id = NULL WHERE id = ?").run("purchase_1");
    const { resolveRefundPurchase } = await import("@/domains/billing/server/billing-adjustments");
    await expect(resolveRefundPurchase("pi_stripe_1")).rejects.toThrow("one paid purchase");
  });

  it("fails explicitly when the auth database is unavailable", async () => {
    mocks.getAuthDatabase.mockReturnValue(null);
    const { resolveRefundPurchase } = await import("@/domains/billing/server/billing-adjustments");
    await expect(resolveRefundPurchase("pi_stripe_1")).rejects.toThrow("Auth database unavailable");
  });

  it("refuses an ambiguous invoice payment", async () => {
    configureInvoiceAttribution();
    mocks.listInvoicePayments.mockResolvedValue({ data: [], has_more: true });
    const { resolveRefundPurchase } = await import("@/domains/billing/server/billing-adjustments");
    await expect(resolveRefundPurchase("pi_stripe_1")).rejects.toThrow("one paid invoice");
  });

  it("refuses a missing invoice in a reported invoice payment", async () => {
    configureInvoiceAttribution();
    mocks.listInvoicePayments.mockResolvedValue({ data: [undefined], has_more: false });
    const { resolveRefundPurchase } = await import("@/domains/billing/server/billing-adjustments");
    await expect(resolveRefundPurchase("pi_stripe_1")).rejects.toThrow("current invoice");
  });

  it("accepts expanded invoice, subscription, and latest-invoice references", async () => {
    configureInvoiceAttribution();
    mocks.listInvoicePayments.mockResolvedValue({
      data: [{ invoice: { id: "in_1" } }],
      has_more: false,
    });
    mocks.retrieveInvoice.mockResolvedValue({
      id: "in_1",
      parent: { subscription_details: { subscription: { id: "sub_1" } } },
    });
    mocks.retrieveSubscription.mockResolvedValue({
      id: "sub_1",
      latest_invoice: { id: "in_1" },
      status: "canceled",
    });
    const { resolveRefundPurchase } = await import("@/domains/billing/server/billing-adjustments");
    await expect(resolveRefundPurchase("pi_stripe_1")).resolves.toMatchObject({
      currentTerm: true,
      cancelSubscriptionId: null,
      purchase: { id: "purchase_1" },
    });
  });

  it("refuses an invoice without a subscription and one without a matching purchase", async () => {
    configureInvoiceAttribution();
    const { resolveRefundPurchase } = await import("@/domains/billing/server/billing-adjustments");
    mocks.retrieveInvoice.mockResolvedValue({ id: "in_1", parent: null });
    await expect(resolveRefundPurchase("pi_stripe_1")).rejects.toThrow("to a subscription");
    mocks.retrieveInvoice.mockResolvedValue({
      id: "in_1",
      parent: { subscription_details: { subscription: "sub_other" } },
    });
    await expect(resolveRefundPurchase("pi_stripe_1")).rejects.toThrow("one paid purchase");
  });

  it("refuses an invoice linked to a different saved purchase", async () => {
    db.prepare("UPDATE purchase_intents SET stripe_subscription_id = ? WHERE id = ?").run(
      "sub_direct",
      "purchase_1",
    );
    insertPurchaseIntentRow(db, {
      id: "purchase_2",
      status: "paid",
      stripeCheckoutSessionId: "cs_2",
      userId: "buyer_2",
      workspaceId: "org_2",
      product: "atlas_team",
      interval: "monthly",
    });
    db.prepare("UPDATE purchase_intents SET stripe_subscription_id = ? WHERE id = ?").run(
      "sub_other",
      "purchase_2",
    );
    mocks.listInvoicePayments.mockResolvedValue({ data: [{ invoice: "in_1" }], has_more: false });
    mocks.retrieveInvoice.mockResolvedValue({
      id: "in_1",
      parent: { subscription_details: { subscription: "sub_other" } },
    });
    const { resolveRefundPurchase } = await import("@/domains/billing/server/billing-adjustments");
    await expect(resolveRefundPurchase("pi_stripe_1")).rejects.toThrow("one paid purchase");
  });

  it("requires a charge before recording a refund", async () => {
    const { applyStripeRefund } = await import("@/domains/billing/server/billing-adjustments");
    const refund = buildRefundEvent().data.object as Stripe.Refund;
    await expect(
      applyStripeRefund({ ...refund, charge: null }, "evt_1", "2026-07-03T00:00:00Z"),
    ).rejects.toThrow("to a charge");
    expect(db.prepare("SELECT COUNT(*) AS count FROM billing_adjustments").get()).toEqual({
      count: 0,
    });
  });

  it("accepts expanded charge and PaymentIntent references", async () => {
    mocks.retrieveCharge.mockResolvedValue({
      id: "ch_1",
      amount: 400,
      currency: "usd",
      payment_intent: { id: "pi_stripe_1" },
      paid: true,
    });
    const { applyStripeRefund } = await import("@/domains/billing/server/billing-adjustments");
    const refund = buildRefundEvent().data.object as Stripe.Refund;
    await applyStripeRefund(
      { ...refund, charge: { id: "ch_1" }, payment_intent: { id: "pi_stripe_1" } } as Stripe.Refund,
      "evt_1",
      "2026-07-03T00:00:00Z",
    );
    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "refunded",
    });
  });

  it("retries if the local database disappears before the adjustment or revocation", async () => {
    const { applyStripeRefund } = await import("@/domains/billing/server/billing-adjustments");
    const refund = buildRefundEvent().data.object as Stripe.Refund;
    mocks.getAuthDatabase.mockReturnValueOnce(db).mockReturnValueOnce(null);
    await expect(applyStripeRefund(refund, "evt_1", "2026-07-03T00:00:00Z")).rejects.toThrow(
      "Auth database unavailable",
    );
    mocks.getAuthDatabase
      .mockReset()
      .mockReturnValueOnce(db)
      .mockReturnValueOnce(db)
      .mockReturnValueOnce(null);
    await expect(applyStripeRefund(refund, "evt_1", "2026-07-03T00:00:00Z")).rejects.toThrow(
      "Auth database unavailable",
    );
    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "active",
    });
  });

  it("revokes a fully refunded pass and records one adjustment across retries", async () => {
    await deliver(buildRefundEvent());
    await deliver(buildRefundEvent());

    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "refunded",
    });
    expect(
      db
        .prepare("SELECT revoked_at, revocation_reason FROM purchase_intents WHERE id = ?")
        .get("purchase_1"),
    ).toEqual({
      revoked_at: "2026-07-03T00:00:00.000Z",
      revocation_reason: "full_refund",
    });
    expect(
      db.prepare("SELECT stripe_refund_id, kind, amount, currency FROM billing_adjustments").all(),
    ).toEqual([{ stripe_refund_id: "re_1", kind: "full", amount: 400, currency: "usd" }]);
  });

  it("handles a refund-created event before its update", async () => {
    await deliver({ ...buildRefundEvent(), type: "refund.created" } as Stripe.Event);
    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "refunded",
    });
  });

  it("records and revokes the same refund through the production Postgres path", async () => {
    mocks.getAuthPgPool.mockReturnValue(createSqlitePgPool(db).pool);
    mocks.getAuthDatabase.mockReturnValue(null);

    await deliver(buildRefundEvent());

    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "refunded",
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM billing_adjustments").get()).toEqual({
      count: 1,
    });
  });

  it("records a partial refund without removing the remaining access", async () => {
    await deliver(buildRefundEvent({ amount: 100 }));

    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "active",
    });
    expect(db.prepare("SELECT kind FROM billing_adjustments").get()).toEqual({ kind: "partial" });
  });

  it("revokes a term when separate partial refunds together return the full charge", async () => {
    mocks.retrieveCharge
      .mockResolvedValueOnce({
        id: "ch_1",
        amount: 400,
        amount_refunded: 100,
        currency: "usd",
        payment_intent: "pi_stripe_1",
        paid: true,
        refunded: false,
      })
      .mockResolvedValueOnce({
        id: "ch_1",
        amount: 400,
        amount_refunded: 400,
        currency: "usd",
        payment_intent: "pi_stripe_1",
        paid: true,
        refunded: true,
      });

    await deliver(buildRefundEvent({ id: "re_first", amount: 100 }));
    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "active",
    });

    await deliver({
      ...buildRefundEvent({ id: "re_second", amount: 300 }),
      id: "evt_refund_second",
      created: Date.parse("2026-07-04T00:00:00.000Z") / 1000,
    });

    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "refunded",
    });
    expect(
      db.prepare("SELECT revocation_reason FROM purchase_intents WHERE id = ?").get("purchase_1"),
    ).toEqual({ revocation_reason: "full_refund" });
    expect(
      db
        .prepare("SELECT stripe_refund_id, kind, amount FROM billing_adjustments ORDER BY amount")
        .all(),
    ).toEqual([
      { stripe_refund_id: "re_first", kind: "partial", amount: 100 },
      { stripe_refund_id: "re_second", kind: "partial", amount: 300 },
    ]);
  });

  it("does not act on a refund that has not succeeded", async () => {
    await deliver(buildRefundEvent({ status: "pending" }));
    expect(db.prepare("SELECT COUNT(*) AS count FROM billing_adjustments").get()).toEqual({
      count: 0,
    });
  });

  it("fails unattributable refunds so Stripe can retry", async () => {
    await expect(deliver(buildRefundEvent({ payment_intent: "pi_other" }))).rejects.toThrow(
      "could not attribute",
    );
    expect(db.prepare("SELECT COUNT(*) AS count FROM billing_adjustments").get()).toEqual({
      count: 0,
    });
  });

  it("does not revoke a newer purchase of the same product", async () => {
    db.prepare("UPDATE workspace_products SET purchase_intent_id = ? WHERE id = ?").run(
      "purchase_new",
      "wp_1",
    );
    await deliver(buildRefundEvent());
    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "active",
    });
  });

  it("attributes a current subscription invoice refund to its workspace", async () => {
    db.prepare(
      `UPDATE purchase_intents SET product = 'atlas_team', stripe_payment_intent_id = NULL,
       stripe_subscription_id = 'sub_1' WHERE id = 'purchase_1'`,
    ).run();
    db.prepare(
      `UPDATE workspace_products SET product = 'atlas_team', stripe_subscription_id = 'sub_1'
       WHERE id = 'wp_1'`,
    ).run();
    mocks.listInvoicePayments.mockResolvedValue({
      data: [{ invoice: "in_1", status: "paid" }],
      has_more: false,
    });
    mocks.retrieveInvoice.mockResolvedValue({
      id: "in_1",
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } },
    });
    mocks.retrieveSubscription.mockResolvedValue({
      id: "sub_1",
      latest_invoice: "in_1",
      status: "active",
    });
    mocks.cancelSubscription.mockResolvedValue({ id: "sub_1", status: "canceled" });

    await deliver(buildRefundEvent());
    await deliver(
      buildSubscriptionEvent({
        created: Date.parse("2026-07-04T00:00:00.000Z") / 1000,
        status: "active",
        subscriptionId: "sub_1",
        type: "customer.subscription.updated",
      }),
    );

    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "refunded",
    });
    expect(mocks.listInvoicePayments).toHaveBeenCalledWith({
      payment: { type: "payment_intent", payment_intent: "pi_stripe_1" },
      status: "paid",
      limit: 2,
    });
    expect(mocks.cancelSubscription).toHaveBeenCalledWith(
      "sub_1",
      { invoice_now: false, prorate: false },
      { idempotencyKey: "atlas-refund-cancel-re_1" },
    );
  });

  it("records an older subscription invoice refund without revoking the current term", async () => {
    db.prepare(
      `UPDATE purchase_intents SET product = 'atlas_team', stripe_payment_intent_id = NULL,
       stripe_subscription_id = 'sub_1' WHERE id = 'purchase_1'`,
    ).run();
    db.prepare(
      `UPDATE workspace_products SET product = 'atlas_team', stripe_subscription_id = 'sub_1'
       WHERE id = 'wp_1'`,
    ).run();
    mocks.listInvoicePayments.mockResolvedValue({
      data: [{ invoice: "in_old", status: "paid" }],
      has_more: false,
    });
    mocks.retrieveInvoice.mockResolvedValue({
      id: "in_old",
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } },
    });
    mocks.retrieveSubscription.mockResolvedValue({
      id: "sub_1",
      latest_invoice: "in_current",
      status: "active",
    });

    await deliver(buildRefundEvent());

    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "active",
    });
    expect(db.prepare("SELECT kind FROM billing_adjustments").get()).toEqual({ kind: "full" });
    expect(mocks.cancelSubscription).not.toHaveBeenCalled();
  });
});
