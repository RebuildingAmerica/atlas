import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import { insertPurchaseIntentRow } from "../../../../helpers/billing/purchase-intent-rows";

const mocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn<() => Database.Database | null>(),
  getAuthPgPool: vi.fn<() => unknown>(),
  retrieveSession: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveCharge: vi.fn(),
  createRefund: vi.fn(),
  retrieveSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  listInvoicePayments: vi.fn(),
  retrieveInvoice: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => ({
  getAuthDatabase: mocks.getAuthDatabase,
  getAuthPgPool: mocks.getAuthPgPool,
}));
vi.mock("@/domains/billing/server/stripe-client", () => ({
  getStripeClient: () => ({
    checkout: { sessions: { retrieve: mocks.retrieveSession } },
    paymentIntents: { retrieve: mocks.retrievePaymentIntent },
    charges: { retrieve: mocks.retrieveCharge },
    refunds: { create: mocks.createRefund },
    subscriptions: { retrieve: mocks.retrieveSubscription, cancel: mocks.cancelSubscription },
    invoicePayments: { list: mocks.listInvoicePayments },
    invoices: { retrieve: mocks.retrieveInvoice },
  }),
}));

describe("operator refund", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getAuthDatabase.mockReturnValue(db);
    mocks.getAuthPgPool.mockReturnValue(null);
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
    mocks.retrieveSession.mockResolvedValue({
      id: "cs_1",
      mode: "payment",
      livemode: false,
      payment_status: "paid",
      payment_intent: "pi_stripe_1",
      subscription: null,
      metadata: {
        interval: "weekly",
        product: "atlas_research_pass",
        purchase_intent_id: "purchase_1",
        workspace_id: "org_1",
      },
    });
    mocks.retrievePaymentIntent.mockResolvedValue({ id: "pi_stripe_1", latest_charge: "ch_1" });
    mocks.retrieveCharge.mockResolvedValue({
      id: "ch_1",
      amount: 400,
      amount_refunded: 0,
      currency: "usd",
      paid: true,
      payment_intent: "pi_stripe_1",
    });
    mocks.createRefund.mockResolvedValue({
      id: "re_1",
      amount: 400,
      charge: "ch_1",
      currency: "usd",
      payment_intent: "pi_stripe_1",
      status: "succeeded",
      metadata: {},
    });
  });

  afterEach(() => db.close());

  function configureSubscription(): void {
    db.prepare(
      `UPDATE purchase_intents SET product = 'atlas_team', interval = 'monthly',
       stripe_payment_intent_id = NULL, stripe_subscription_id = 'sub_1' WHERE id = 'purchase_1'`,
    ).run();
    db.prepare(
      `UPDATE workspace_products SET product = 'atlas_team', stripe_subscription_id = 'sub_1'
       WHERE id = 'wp_1'`,
    ).run();
    mocks.retrieveSession.mockResolvedValue({
      id: "cs_1",
      mode: "subscription",
      livemode: true,
      payment_status: "paid",
      payment_intent: null,
      subscription: "sub_1",
      metadata: {
        interval: "monthly",
        product: "atlas_team",
        purchase_intent_id: "purchase_1",
        workspace_id: "org_1",
      },
    });
    mocks.retrieveSubscription.mockResolvedValue({
      id: "sub_1",
      latest_invoice: "in_1",
      status: "canceled",
    });
    mocks.listInvoicePayments.mockImplementation((params: { invoice?: string }) =>
      Promise.resolve(
        params.invoice
          ? {
              data: [{ payment: { type: "payment_intent", payment_intent: "pi_stripe_1" } }],
              has_more: false,
            }
          : { data: [{ invoice: "in_1", status: "paid" }], has_more: false },
      ),
    );
    mocks.retrieveInvoice.mockResolvedValue({
      id: "in_1",
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } },
    });
  }

  it("previews the exact paid purchase without provider mutation", async () => {
    const { previewOperatorRefund } = await import("@/domains/billing/server/refund-operator");

    await expect(previewOperatorRefund("cs_1")).resolves.toMatchObject({
      amount: 400,
      currency: "usd",
      purchaseIntentId: "purchase_1",
      stripeMode: "test",
      subscriptionId: null,
      workspaceId: "org_1",
    });
    expect(mocks.createRefund).not.toHaveBeenCalled();
    expect(mocks.cancelSubscription).not.toHaveBeenCalled();
  });

  it("rejects unpaid or unattributable Checkout without reading a charge", async () => {
    mocks.retrieveSession.mockResolvedValue({
      id: "cs_1",
      payment_status: "unpaid",
      metadata: {},
    });
    const { previewOperatorRefund } = await import("@/domains/billing/server/refund-operator");
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow("attributable paid");
    expect(mocks.retrieveCharge).not.toHaveBeenCalled();
  });

  it("rejects a purchase that was already revoked", async () => {
    db.prepare("UPDATE purchase_intents SET revoked_at = ? WHERE id = ?").run(
      "2026-07-03T00:00:00.000Z",
      "purchase_1",
    );
    const { previewOperatorRefund } = await import("@/domains/billing/server/refund-operator");
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow("already been revoked");
  });

  it("rejects Checkout with a product-mode mismatch", async () => {
    const session = (await mocks.retrieveSession("cs_1")) as Record<string, unknown>;
    mocks.retrieveSession.mockResolvedValue({ ...session, mode: "subscription" });
    const { previewOperatorRefund } = await import("@/domains/billing/server/refund-operator");
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow("mode does not match");
  });

  it("rejects missing or mismatched provider payment evidence", async () => {
    const { previewOperatorRefund } = await import("@/domains/billing/server/refund-operator");
    const session = (await mocks.retrieveSession("cs_1")) as Record<string, unknown>;
    mocks.retrieveSession.mockResolvedValue({ ...session, payment_intent: null });
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow("no refundable PaymentIntent");
    mocks.retrieveSession.mockResolvedValue(session);
    mocks.retrievePaymentIntent.mockResolvedValue({ id: "pi_stripe_1", latest_charge: null });
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow("no paid charge");
    mocks.retrievePaymentIntent.mockResolvedValue({ id: "pi_stripe_1", latest_charge: "ch_1" });
    mocks.retrieveCharge.mockResolvedValue({
      id: "ch_1",
      amount: 400,
      amount_refunded: 0,
      currency: "usd",
      paid: false,
      payment_intent: "pi_stripe_1",
    });
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow("Charge is unpaid");
  });

  it("rejects a payment attributed to another saved purchase", async () => {
    db.prepare("UPDATE purchase_intents SET stripe_payment_intent_id = NULL WHERE id = ?").run(
      "purchase_1",
    );
    insertPurchaseIntentRow(db, {
      id: "purchase_2",
      status: "paid",
      stripeCheckoutSessionId: "cs_2",
      userId: "other",
      workspaceId: "org_2",
      product: "atlas_research_pass",
      interval: "weekly",
    });
    db.prepare("UPDATE purchase_intents SET stripe_payment_intent_id = ? WHERE id = ?").run(
      "pi_stripe_1",
      "purchase_2",
    );
    const { previewOperatorRefund } = await import("@/domains/billing/server/refund-operator");
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow(
      "does not match the current Atlas purchase",
    );
  });

  it("refunds a full pass and records local revocation", async () => {
    const { executeOperatorRefund } = await import("@/domains/billing/server/refund-operator");

    await expect(
      executeOperatorRefund("cs_1", "owner@atlas.test", "Buyer request"),
    ).resolves.toMatchObject({
      refundId: "re_1",
      status: "succeeded",
    });
    expect(mocks.createRefund).toHaveBeenCalledWith(
      {
        payment_intent: "pi_stripe_1",
        metadata: { atlas_operator_id: "owner@atlas.test", atlas_reason: "Buyer request" },
      },
      { idempotencyKey: "atlas-refund-cs_1" },
    );
    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "refunded",
    });
  });

  it("requires an operator identity and reason before provider work", async () => {
    const { executeOperatorRefund } = await import("@/domains/billing/server/refund-operator");
    await expect(executeOperatorRefund("cs_1", " ", "Buyer request")).rejects.toThrow("required");
    await expect(executeOperatorRefund("cs_1", "owner@atlas.test", " ")).rejects.toThrow(
      "required",
    );
    expect(mocks.retrieveSession).not.toHaveBeenCalled();
  });

  it("does not revoke access before a pending refund succeeds", async () => {
    mocks.createRefund.mockResolvedValue({ id: "re_pending", status: "pending" });
    const { executeOperatorRefund } = await import("@/domains/billing/server/refund-operator");
    await expect(
      executeOperatorRefund("cs_1", "owner@atlas.test", "Buyer request"),
    ).resolves.toMatchObject({ status: "pending" });
    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "active",
    });
  });

  it("previews a live subscription and does not cancel it twice", async () => {
    configureSubscription();
    const { executeOperatorRefund } = await import("@/domains/billing/server/refund-operator");
    await expect(
      executeOperatorRefund("cs_1", "owner@atlas.test", "Buyer request"),
    ).resolves.toMatchObject({
      plan: { stripeMode: "live", subscriptionId: "sub_1" },
    });
    expect(mocks.cancelSubscription).not.toHaveBeenCalled();
  });

  it("refuses a subscription with no identifiable paid invoice", async () => {
    configureSubscription();
    mocks.retrieveSubscription.mockResolvedValue({
      id: "sub_1",
      latest_invoice: null,
      status: "active",
    });
    const { previewOperatorRefund } = await import("@/domains/billing/server/refund-operator");
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow("no refundable invoice");
  });

  it("refuses an ambiguous invoice payment or a non-PaymentIntent payment", async () => {
    configureSubscription();
    const { previewOperatorRefund } = await import("@/domains/billing/server/refund-operator");
    mocks.listInvoicePayments.mockResolvedValue({ data: [], has_more: true });
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow("one paid payment");
    mocks.listInvoicePayments.mockResolvedValue({
      data: [{ payment: { type: "charge" } }],
      has_more: false,
    });
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow("no refundable PaymentIntent");
    mocks.listInvoicePayments.mockResolvedValue({ data: [undefined], has_more: false });
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow("no refundable PaymentIntent");
    mocks.listInvoicePayments.mockResolvedValue({
      data: [{ payment: { type: "payment_intent", payment_intent: null } }],
      has_more: false,
    });
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow("no refundable PaymentIntent");
  });

  it("refuses an old subscription term", async () => {
    configureSubscription();
    mocks.retrieveSubscription.mockResolvedValue({
      id: "sub_1",
      latest_invoice: "in_new",
      status: "active",
    });
    const { previewOperatorRefund } = await import("@/domains/billing/server/refund-operator");
    await expect(previewOperatorRefund("cs_1")).rejects.toThrow(
      "does not match the current Atlas purchase term",
    );
  });

  it("rejects an already partially refunded charge before mutation", async () => {
    mocks.retrieveCharge.mockResolvedValue({
      id: "ch_1",
      amount: 400,
      amount_refunded: 100,
      currency: "usd",
      paid: true,
      payment_intent: "pi_stripe_1",
    });
    const { executeOperatorRefund } = await import("@/domains/billing/server/refund-operator");

    await expect(
      executeOperatorRefund("cs_1", "owner@atlas.test", "Buyer request"),
    ).rejects.toThrow("partially refunded");
    expect(mocks.createRefund).not.toHaveBeenCalled();
  });

  it("cancels a subscription before issuing the refund", async () => {
    db.prepare(
      `UPDATE purchase_intents SET product = 'atlas_team', interval = 'monthly',
       stripe_payment_intent_id = NULL, stripe_subscription_id = 'sub_1' WHERE id = 'purchase_1'`,
    ).run();
    db.prepare(
      `UPDATE workspace_products SET product = 'atlas_team', stripe_subscription_id = 'sub_1'
       WHERE id = 'wp_1'`,
    ).run();
    mocks.retrieveSession.mockResolvedValue({
      id: "cs_1",
      mode: "subscription",
      livemode: false,
      payment_status: "paid",
      payment_intent: null,
      subscription: "sub_1",
      metadata: {
        interval: "monthly",
        product: "atlas_team",
        purchase_intent_id: "purchase_1",
        workspace_id: "org_1",
      },
    });
    let canceled = false;
    mocks.retrieveSubscription.mockImplementation(() =>
      Promise.resolve({
        id: "sub_1",
        latest_invoice: "in_1",
        status: canceled ? "canceled" : "active",
      }),
    );
    mocks.cancelSubscription.mockImplementation(() => {
      canceled = true;
      return Promise.resolve({ id: "sub_1", status: "canceled" });
    });
    mocks.listInvoicePayments.mockImplementation((params: { invoice?: string }) =>
      Promise.resolve(
        params.invoice
          ? {
              data: [{ payment: { type: "payment_intent", payment_intent: "pi_stripe_1" } }],
              has_more: false,
            }
          : { data: [{ invoice: "in_1", status: "paid" }], has_more: false },
      ),
    );
    mocks.retrieveInvoice.mockResolvedValue({
      id: "in_1",
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } },
    });

    const { executeOperatorRefund } = await import("@/domains/billing/server/refund-operator");
    await executeOperatorRefund("cs_1", "owner@atlas.test", "Buyer request");

    expect(mocks.cancelSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.cancelSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createRefund.mock.invocationCallOrder[0] ?? 0,
    );
    expect(db.prepare("SELECT status FROM workspace_products WHERE id = ?").get("wp_1")).toEqual({
      status: "refunded",
    });
  });
});
