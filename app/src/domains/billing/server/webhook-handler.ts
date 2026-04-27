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
 * Converts a Stripe event `created` epoch-seconds value into the ISO string
 * format Atlas stores in `workspace_products.stripe_event_at`.
 *
 * @param createdEpochSeconds - The Stripe event creation timestamp.
 */
function eventCreatedToIso(createdEpochSeconds: number): string {
  return new Date(createdEpochSeconds * 1000).toISOString();
}

/**
 * Upserts a row in workspace_products for the given workspace and product.
 *
 * The upsert respects event ordering: if an existing row has a
 * `stripe_event_at` newer than the incoming event, the row is left untouched
 * so a delayed/out-of-order webhook cannot regress live state.
 *
 * @param params - The workspace product row values.
 */
async function upsertWorkspaceProduct(params: {
  workspaceId: string;
  product: string;
  status: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  eventAt: string;
}): Promise<void> {
  const { workspaceId, product, status, stripeSubscriptionId, stripeCustomerId, eventAt } = params;
  const id = crypto.randomUUID();

  const pool = getAuthPgPool();
  if (pool) {
    await pool.query(
      `INSERT INTO workspace_products (id, workspace_id, product, status, stripe_subscription_id, stripe_customer_id, stripe_event_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id, product) DO UPDATE
       SET status = EXCLUDED.status,
           stripe_subscription_id = EXCLUDED.stripe_subscription_id,
           stripe_customer_id = EXCLUDED.stripe_customer_id,
           stripe_event_at = EXCLUDED.stripe_event_at
       WHERE workspace_products.stripe_event_at IS NULL
          OR workspace_products.stripe_event_at <= EXCLUDED.stripe_event_at`,
      [id, workspaceId, product, status, stripeSubscriptionId, stripeCustomerId, eventAt],
    );
    return;
  }

  const db = getAuthDatabase();
  if (!db) {
    throw new Error("Auth database unavailable in current mode");
  }

  db.prepare(
    `INSERT INTO workspace_products (id, workspace_id, product, status, stripe_subscription_id, stripe_customer_id, stripe_event_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, product) DO UPDATE
     SET status = excluded.status,
         stripe_subscription_id = excluded.stripe_subscription_id,
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_event_at = excluded.stripe_event_at
     WHERE workspace_products.stripe_event_at IS NULL
        OR workspace_products.stripe_event_at <= excluded.stripe_event_at`,
  ).run(id, workspaceId, product, status, stripeSubscriptionId, stripeCustomerId, eventAt);
}

/**
 * Updates the status column for all workspace_products rows matching a given
 * Stripe subscription ID.
 *
 * Older events are ignored: a row whose stored `stripe_event_at` is newer than
 * the incoming event will not be modified.
 *
 * @param stripeSubscriptionId - The Stripe subscription ID to match.
 * @param status - The new status value.
 * @param eventAt - The ISO timestamp of the inbound Stripe event.
 */
async function updateWorkspaceProductStatusBySubscription(
  stripeSubscriptionId: string,
  status: string,
  eventAt: string,
): Promise<void> {
  const pool = getAuthPgPool();
  if (pool) {
    await pool.query(
      `UPDATE workspace_products
       SET status = $1, stripe_event_at = $2
       WHERE stripe_subscription_id = $3
         AND (stripe_event_at IS NULL OR stripe_event_at <= $2)`,
      [status, eventAt, stripeSubscriptionId],
    );
    return;
  }

  const db = getAuthDatabase();
  if (!db) {
    throw new Error("Auth database unavailable in current mode");
  }

  db.prepare(
    `UPDATE workspace_products
     SET status = ?, stripe_event_at = ?
     WHERE stripe_subscription_id = ?
       AND (stripe_event_at IS NULL OR stripe_event_at <= ?)`,
  ).run(status, eventAt, stripeSubscriptionId, eventAt);
}

/**
 * Handles a completed Stripe Checkout Session by creating or updating the
 * workspace product row and persisting the Stripe customer ID on the
 * organization metadata.
 *
 * @param session - The Stripe Checkout Session object from the webhook event.
 * @param eventAt - The ISO timestamp of the inbound Stripe event.
 */
async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventAt: string,
): Promise<void> {
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
    eventAt,
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
 * Handles a newly created Stripe subscription by ensuring a workspace product
 * row exists.
 *
 * Subscription metadata carries workspace_id and product when the checkout
 * session was created with subscription_data.metadata.  If the metadata is
 * missing (e.g. legacy sessions), the handler is a no-op — the
 * checkout.session.completed handler will create the row instead.
 *
 * @param subscription - The Stripe Subscription object from the webhook event.
 * @param eventAt - The ISO timestamp of the inbound Stripe event.
 */
async function handleSubscriptionCreated(
  subscription: Stripe.Subscription,
  eventAt: string,
): Promise<void> {
  const workspaceId = subscription.metadata?.workspace_id;
  const product = subscription.metadata?.product;

  if (!workspaceId || !product) {
    return;
  }

  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : (subscription.customer?.id ?? null);

  await upsertWorkspaceProduct({
    workspaceId,
    product,
    status: mapSubscriptionStatus(subscription.status),
    stripeSubscriptionId: subscription.id,
    stripeCustomerId,
    eventAt,
  });
}

/**
 * Handles a Stripe subscription update by synchronizing the workspace product
 * status.
 *
 * @param subscription - The Stripe Subscription object from the webhook event.
 * @param eventAt - The ISO timestamp of the inbound Stripe event.
 */
async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  eventAt: string,
): Promise<void> {
  const atlasStatus = mapSubscriptionStatus(subscription.status);

  await updateWorkspaceProductStatusBySubscription(subscription.id, atlasStatus, eventAt);
}

/**
 * Handles a Stripe subscription deletion by marking the workspace product as
 * cancelled.
 *
 * @param subscription - The Stripe Subscription object from the webhook event.
 * @param eventAt - The ISO timestamp of the inbound Stripe event.
 */
async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  eventAt: string,
): Promise<void> {
  await updateWorkspaceProductStatusBySubscription(subscription.id, "cancelled", eventAt);
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

  const eventAt = eventCreatedToIso(event.created);

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object, eventAt);
      break;
    case "customer.subscription.created":
      await handleSubscriptionCreated(event.data.object, eventAt);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object, eventAt);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object, eventAt);
      break;
  }

  return Response.json({ received: true });
}
