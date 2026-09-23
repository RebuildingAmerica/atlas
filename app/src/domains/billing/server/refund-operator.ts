import "@tanstack/react-start/server-only";

import { applyStripeRefund, resolveRefundPurchase } from "./billing-adjustments";
import { requirePurchaseIntentForCheckout } from "./purchase-intents";
import { getStripeClient } from "./stripe-client";

export interface OperatorRefundPlan {
  amount: number;
  chargeId: string;
  currency: string;
  paymentIntentId: string;
  product: string;
  purchaseIntentId: string;
  sessionId: string;
  stripeMode: "live" | "test";
  subscriptionId: string | null;
  workspaceId: string;
}

function idOf(value: string | { id: string } | null): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}

/** Reads provider and local state without changing either. */
export async function previewOperatorRefund(sessionId: string): Promise<OperatorRefundPlan> {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const purchaseIntentId = session.metadata?.purchase_intent_id;
  const workspaceId = session.metadata?.workspace_id;
  const product = session.metadata?.product;
  if (!purchaseIntentId || !workspaceId || !product || session.payment_status !== "paid") {
    throw new Error("Checkout is not an attributable paid Atlas purchase.");
  }
  if (
    !(await requirePurchaseIntentForCheckout({
      id: purchaseIntentId,
      interval: session.metadata?.interval,
      product,
      stripeCheckoutSessionId: session.id,
      workspaceId,
    }))
  ) {
    throw new Error("This purchase has already been revoked.");
  }

  const subscriptionId = idOf(session.subscription);
  if (
    (product === "atlas_research_pass" && (session.mode !== "payment" || subscriptionId)) ||
    (product !== "atlas_research_pass" && (session.mode !== "subscription" || !subscriptionId))
  ) {
    throw new Error("Checkout mode does not match the purchased product.");
  }

  let paymentIntentId = idOf(session.payment_intent);
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const invoiceId = idOf(subscription.latest_invoice);
    if (!invoiceId) throw new Error("Subscription has no refundable invoice.");
    const payments = await stripe.invoicePayments.list({
      invoice: invoiceId,
      status: "paid",
      limit: 2,
    });
    if (payments.has_more || payments.data.length !== 1) {
      throw new Error("Subscription invoice does not have one paid payment.");
    }
    const payment = payments.data[0]?.payment;
    paymentIntentId =
      payment?.type === "payment_intent" ? idOf(payment.payment_intent ?? null) : null;
  }
  if (!paymentIntentId) throw new Error("Checkout has no refundable PaymentIntent.");

  const attribution = await resolveRefundPurchase(paymentIntentId);
  if (
    attribution.purchase.id !== purchaseIntentId ||
    attribution.purchase.workspace_id !== workspaceId ||
    attribution.purchase.product !== product ||
    !attribution.currentTerm
  ) {
    throw new Error("Payment does not match the current Atlas purchase term.");
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const chargeId = idOf(paymentIntent.latest_charge);
  if (!chargeId) throw new Error("PaymentIntent has no paid charge.");
  const charge = await stripe.charges.retrieve(chargeId);
  if (
    !charge.paid ||
    idOf(charge.payment_intent) !== paymentIntentId ||
    charge.amount <= 0 ||
    charge.amount_refunded !== 0
  ) {
    throw new Error("Charge is unpaid, partially refunded, or already refunded.");
  }

  return {
    amount: charge.amount,
    chargeId,
    currency: charge.currency,
    paymentIntentId,
    product,
    purchaseIntentId,
    sessionId: session.id,
    stripeMode: session.livemode ? "live" : "test",
    subscriptionId,
    workspaceId,
  };
}

/** Rechecks the purchase, cancels recurring billing, and refunds the full charge. */
export async function executeOperatorRefund(
  sessionId: string,
  operatorId: string,
  reason: string,
): Promise<{ plan: OperatorRefundPlan; refundId: string; status: string | null }> {
  if (!operatorId.trim() || !reason.trim()) {
    throw new Error("Operator identity and refund reason are required.");
  }
  const plan = await previewOperatorRefund(sessionId);
  const stripe = getStripeClient();
  if (plan.subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(plan.subscriptionId);
    if (subscription.status !== "canceled") {
      await stripe.subscriptions.cancel(
        plan.subscriptionId,
        { invoice_now: false, prorate: false },
        { idempotencyKey: `atlas-refund-cancel-${plan.sessionId}` },
      );
    }
  }
  const refund = await stripe.refunds.create(
    {
      payment_intent: plan.paymentIntentId,
      metadata: { atlas_operator_id: operatorId.trim(), atlas_reason: reason.trim() },
    },
    { idempotencyKey: `atlas-refund-${plan.sessionId}` },
  );
  if (refund.status === "succeeded") {
    await applyStripeRefund(refund, `operator:${refund.id}`, new Date().toISOString());
  }
  return { plan, refundId: refund.id, status: refund.status };
}
