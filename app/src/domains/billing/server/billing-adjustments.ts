import "@tanstack/react-start/server-only";

import type Stripe from "stripe";
import { getAuthDatabase, getAuthPgPool } from "@/domains/access/server/auth";
import { getStripeClient } from "./stripe-client";

interface RefundedPurchase {
  id: string;
  workspace_id: string;
  product: string;
  stripe_subscription_id: string | null;
}

async function findPurchaseByReference(
  reference: "payment" | "subscription",
  providerId: string,
): Promise<RefundedPurchase | null> {
  const column = reference === "payment" ? "stripe_payment_intent_id" : "stripe_subscription_id";
  const pool = getAuthPgPool();
  let rows: RefundedPurchase[];
  if (pool) {
    const result = await pool.query<RefundedPurchase>(
      `SELECT id, workspace_id, product, stripe_subscription_id FROM purchase_intents
       WHERE ${column} = $1 AND status = 'paid' LIMIT 2`,
      [providerId],
    );
    rows = result.rows;
  } else {
    const db = getAuthDatabase();
    if (!db) throw new Error("Auth database unavailable in current mode");
    rows = db
      .prepare(
        `SELECT id, workspace_id, product, stripe_subscription_id FROM purchase_intents
         WHERE ${column} = ? AND status = 'paid' LIMIT 2`,
      )
      .all(providerId) as RefundedPurchase[];
  }
  if (rows.length === 0) return null;
  if (rows.length !== 1 || !rows[0]?.workspace_id) {
    throw new Error("Atlas could not attribute this Stripe refund to one paid purchase.");
  }
  return rows[0];
}

async function resolveRefundPurchase(paymentIntentId: string): Promise<{
  purchase: RefundedPurchase;
  currentTerm: boolean;
  cancelSubscriptionId: string | null;
}> {
  const direct = await findPurchaseByReference("payment", paymentIntentId);
  if (direct && !direct.stripe_subscription_id) {
    return { purchase: direct, currentTerm: true, cancelSubscriptionId: null };
  }

  const stripe = getStripeClient();
  const matches = await stripe.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    status: "paid",
    limit: 2,
  });
  if (matches.has_more || matches.data.length !== 1) {
    throw new Error("Atlas could not attribute this Stripe refund to one paid invoice.");
  }
  const invoicePayment = matches.data[0];
  if (!invoicePayment) {
    throw new Error("Atlas could not attribute this Stripe refund to a current invoice.");
  }
  const invoiceId =
    typeof invoicePayment.invoice === "string" ? invoicePayment.invoice : invoicePayment.invoice.id;
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const subscription = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof subscription === "string" ? subscription : subscription?.id;
  if (!subscriptionId) {
    throw new Error("Atlas could not attribute this Stripe refund to a subscription.");
  }
  const purchase = await findPurchaseByReference("subscription", subscriptionId);
  if (!purchase || (direct && direct.id !== purchase.id)) {
    throw new Error("Atlas could not attribute this Stripe refund to one paid purchase.");
  }
  const liveSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  const latestInvoiceId =
    typeof liveSubscription.latest_invoice === "string"
      ? liveSubscription.latest_invoice
      : liveSubscription.latest_invoice?.id;
  const currentTerm = latestInvoiceId === invoiceId;
  return {
    purchase,
    currentTerm,
    cancelSubscriptionId:
      currentTerm && liveSubscription.status !== "canceled" ? subscriptionId : null,
  };
}

async function writeAdjustment({
  purchase,
  refund,
  eventId,
  eventAt,
  kind,
}: {
  purchase: RefundedPurchase;
  refund: Stripe.Refund;
  eventId: string;
  eventAt: string;
  kind: "full" | "partial";
}): Promise<void> {
  const values = [
    crypto.randomUUID(),
    purchase.id,
    purchase.workspace_id,
    purchase.product,
    refund.id,
    eventId,
    refund.amount,
    refund.currency,
    kind,
    refund.metadata?.atlas_operator_id ?? null,
    refund.metadata?.atlas_reason ?? "provider_refund",
    eventAt,
  ];
  const pool = getAuthPgPool();
  if (pool) {
    await pool.query(
      `INSERT INTO billing_adjustments
       (id, purchase_intent_id, workspace_id, product, stripe_refund_id, stripe_event_id,
        amount, currency, kind, actor_id, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (stripe_refund_id) DO NOTHING`,
      values,
    );
    return;
  }
  const db = getAuthDatabase();
  if (!db) throw new Error("Auth database unavailable in current mode");
  db.prepare(
    `INSERT INTO billing_adjustments
     (id, purchase_intent_id, workspace_id, product, stripe_refund_id, stripe_event_id,
      amount, currency, kind, actor_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (stripe_refund_id) DO NOTHING`,
  ).run(...values);
}

async function revokePurchase(purchase: RefundedPurchase, eventAt: string): Promise<void> {
  const pool = getAuthPgPool();
  if (pool) {
    await pool.query(
      `UPDATE purchase_intents
       SET revoked_at = COALESCE(revoked_at, $1), revocation_reason = 'full_refund', updated_at = $1
       WHERE id = $2 AND status = 'paid'`,
      [eventAt, purchase.id],
    );
    await pool.query(
      `UPDATE workspace_products SET status = 'refunded', stripe_event_at = $1
       WHERE purchase_intent_id = $2 AND workspace_id = $3 AND product = $4`,
      [eventAt, purchase.id, purchase.workspace_id, purchase.product],
    );
    return;
  }
  const db = getAuthDatabase();
  if (!db) throw new Error("Auth database unavailable in current mode");
  db.prepare(
    `UPDATE purchase_intents
     SET revoked_at = COALESCE(revoked_at, ?), revocation_reason = 'full_refund', updated_at = ?
     WHERE id = ? AND status = 'paid'`,
  ).run(eventAt, eventAt, purchase.id);
  db.prepare(
    `UPDATE workspace_products SET status = 'refunded', stripe_event_at = ?
     WHERE purchase_intent_id = ? AND workspace_id = ? AND product = ?`,
  ).run(eventAt, purchase.id, purchase.workspace_id, purchase.product);
}

/** Applies a succeeded provider refund to the exact purchase it reverses. */
export async function applyStripeRefund(
  refund: Stripe.Refund,
  eventId: string,
  eventAt: string,
): Promise<void> {
  if (refund.status !== "succeeded") return;

  const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
  if (!chargeId) throw new Error("Atlas could not attribute this Stripe refund to a charge.");
  const charge = await getStripeClient().charges.retrieve(chargeId);
  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  const refundPaymentIntentId =
    typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  if (
    !paymentIntentId ||
    (refundPaymentIntentId && refundPaymentIntentId !== paymentIntentId) ||
    !charge.paid ||
    charge.currency !== refund.currency ||
    refund.amount <= 0 ||
    refund.amount > charge.amount
  ) {
    throw new Error("Atlas could not attribute this Stripe refund to a valid paid charge.");
  }

  const { purchase, currentTerm, cancelSubscriptionId } =
    await resolveRefundPurchase(paymentIntentId);
  const kind = refund.amount === charge.amount ? "full" : "partial";
  if (kind === "full" && cancelSubscriptionId) {
    await getStripeClient().subscriptions.cancel(
      cancelSubscriptionId,
      { invoice_now: false, prorate: false },
      { idempotencyKey: `atlas-refund-cancel-${refund.id}` },
    );
  }
  await writeAdjustment({ purchase, refund, eventId, eventAt, kind });
  if (kind === "full" && currentTerm) await revokePurchase(purchase, eventAt);
}
