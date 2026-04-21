import "@tanstack/react-start/server-only";

import type Stripe from "stripe";
import { getStripeClient, getStripeWebhookSecret } from "./stripe-client";
import { mergeAtlasOrganizationMetadata } from "../../access/organization-metadata";
import { ensureAuthReady } from "../../access/server/auth";
import { getAuthDatabase, getAuthPgPool } from "../../access/server/auth";

/**
 * Maps a Stripe subscription status string to the Atlas workspace_products
 * status value.
 *
 * @param stripeStatus - The raw Stripe subscription status.
 */
function mapSubscriptionStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
      return "cancelled";
    default:
      return stripeStatus;
  }
}

/**
 * Upserts a row in workspace_products for the given workspace and product.
 *
 * Uses the dual-mode database pattern: PostgreSQL when a pool is available,
 * SQLite otherwise.
 *
 * @param params - The workspace product row values.
 */
async function upsertWorkspaceProduct(params: {
  workspaceId: string;
  product: string;
  status: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
}): Promise<void> {
  const { workspaceId, product, status, stripeSubscriptionId, stripeCustomerId } = params;
  const id = crypto.randomUUID();

  const pool = getAuthPgPool();
  if (pool) {
    await pool.query(
      `INSERT INTO workspace_products (id, workspace_id, product, status, stripe_subscription_id, stripe_customer_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, product) DO UPDATE
       SET status = EXCLUDED.status,
           stripe_subscription_id = EXCLUDED.stripe_subscription_id,
           stripe_customer_id = EXCLUDED.stripe_customer_id`,
      [id, workspaceId, product, status, stripeSubscriptionId, stripeCustomerId],
    );
    return;
  }

  const db = getAuthDatabase();
  if (!db) {
    throw new Error("Auth database unavailable in current mode");
  }

  db.prepare(
    `INSERT INTO workspace_products (id, workspace_id, product, status, stripe_subscription_id, stripe_customer_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, product) DO UPDATE
     SET status = excluded.status,
         stripe_subscription_id = excluded.stripe_subscription_id,
         stripe_customer_id = excluded.stripe_customer_id`,
  ).run(id, workspaceId, product, status, stripeSubscriptionId, stripeCustomerId);
}

/**
 * Updates the status column for all workspace_products rows matching a given
 * Stripe subscription ID.
 *
 * @param stripeSubscriptionId - The Stripe subscription ID to match.
 * @param status - The new status value.
 */
async function updateWorkspaceProductStatusBySubscription(
  stripeSubscriptionId: string,
  status: string,
): Promise<void> {
  const pool = getAuthPgPool();
  if (pool) {
    await pool.query(
      `UPDATE workspace_products SET status = $1 WHERE stripe_subscription_id = $2`,
      [status, stripeSubscriptionId],
    );
    return;
  }

  const db = getAuthDatabase();
  if (!db) {
    throw new Error("Auth database unavailable in current mode");
  }

  db.prepare(`UPDATE workspace_products SET status = ? WHERE stripe_subscription_id = ?`).run(
    status,
    stripeSubscriptionId,
  );
}

/**
 * Handles a completed Stripe Checkout Session by creating or updating the
 * workspace product row and persisting the Stripe customer ID on the
 * organization metadata.
 *
 * @param session - The Stripe Checkout Session object from the webhook event.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const workspaceId = session.metadata?.workspace_id;
  const product = session.metadata?.product;

  if (!workspaceId || !product) {
    return;
  }

  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);

  await upsertWorkspaceProduct({
    workspaceId,
    product,
    status: "active",
    stripeSubscriptionId,
    stripeCustomerId,
  });

  if (stripeCustomerId) {
    const auth = await ensureAuthReady();
    // Webhook handlers run outside a browser session, so pass an empty
    // Headers object to satisfy Better Auth's requireHeaders constraint.
    const webhookHeaders = new Headers();

    const fullOrganization = await auth.api.getFullOrganization({
      headers: webhookHeaders,
      query: { organizationId: workspaceId },
    });

    if (fullOrganization) {
      const mergedMetadata = mergeAtlasOrganizationMetadata(fullOrganization.metadata, {
        stripeCustomerId,
      });

      await auth.api.updateOrganization({
        body: {
          data: { metadata: mergedMetadata },
          organizationId: workspaceId,
        },
        headers: webhookHeaders,
      });
    }
  }
}

/**
 * Handles a Stripe subscription update by synchronizing the workspace product
 * status.
 *
 * @param subscription - The Stripe Subscription object from the webhook event.
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const atlasStatus = mapSubscriptionStatus(subscription.status);

  await updateWorkspaceProductStatusBySubscription(subscription.id, atlasStatus);
}

/**
 * Handles a Stripe subscription deletion by marking the workspace product as
 * cancelled.
 *
 * @param subscription - The Stripe Subscription object from the webhook event.
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  await updateWorkspaceProductStatusBySubscription(subscription.id, "cancelled");
}

/**
 * Verifies and dispatches an incoming Stripe webhook event.
 *
 * @param request - The raw incoming webhook Request from Stripe.
 */
export async function handleStripeWebhook(request: Request): Promise<Response> {
  const stripe = getStripeClient();
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return Response.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, getStripeWebhookSecret());
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object);
      break;
  }

  return Response.json({ received: true });
}
