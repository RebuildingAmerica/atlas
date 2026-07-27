import type Database from "better-sqlite3";
import type Stripe from "stripe";
import type { WorkspaceProductStatusRow } from "@/domains/access/server/workspace-products";

export interface ResearchPassCheckoutEventOptions {
  created: number;
  interval: "once" | "weekly";
  purchaseIntentId?: string;
}

export function buildResearchPassCheckoutCompletedEvent(
  options: ResearchPassCheckoutEventOptions,
): Stripe.Event {
  return {
    id: "evt_research_pass",
    object: "event",
    api_version: "2026-02-29.clover",
    created: options.created,
    data: {
      object: {
        id: "cs_research_pass",
        object: "checkout.session",
        customer: null,
        metadata: {
          interval: options.interval,
          product: "atlas_research_pass",
          ...(options.purchaseIntentId ? { purchase_intent_id: options.purchaseIntentId } : {}),
          workspace_id: "org_research",
        },
        subscription: null,
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
  } as unknown as Stripe.Event;
}

export interface CheckoutCompletedEventOptions {
  created: number;
  /** A bare id string, an expanded object, or null, as Stripe sends each. */
  customer?: string | { id: string } | null;
  metadata?: Record<string, string>;
  sessionId?: string;
  subscription?: string | { id: string } | null;
}

/**
 * Builds a `checkout.session.completed` event with arbitrary metadata, for the
 * cases the Research Pass builder cannot express: a missing workspace, an
 * expanded customer object, a subscription product.
 *
 * @param options - Overrides for the session fields the handler reads.
 * @returns A Stripe event shaped like the real webhook payload.
 */
export function buildCheckoutCompletedEvent(options: CheckoutCompletedEventOptions): Stripe.Event {
  return {
    id: "evt_checkout",
    object: "event",
    api_version: "2026-02-29.clover",
    created: options.created,
    data: {
      object: {
        id: options.sessionId ?? "cs_checkout",
        object: "checkout.session",
        customer: options.customer ?? null,
        metadata: options.metadata ?? {},
        subscription: options.subscription ?? null,
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
  } as unknown as Stripe.Event;
}

export interface SubscriptionEventOptions {
  created: number;
  customer?: string | { id: string } | null;
  metadata?: Record<string, string>;
  status: string;
  subscriptionId?: string;
  type:
    | "customer.subscription.created"
    | "customer.subscription.deleted"
    | "customer.subscription.updated";
}

/**
 * Builds a `customer.subscription.*` event.
 *
 * @param options - The subscription fields the handlers read, plus the event type.
 * @returns A Stripe event shaped like the real webhook payload.
 */
export function buildSubscriptionEvent(options: SubscriptionEventOptions): Stripe.Event {
  return {
    id: "evt_subscription",
    object: "event",
    api_version: "2026-02-29.clover",
    created: options.created,
    data: {
      object: {
        id: options.subscriptionId ?? "sub_test",
        object: "subscription",
        customer: options.customer ?? null,
        metadata: options.metadata ?? {},
        status: options.status,
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: options.type,
  } as unknown as Stripe.Event;
}

export function readWorkspaceProduct(
  db: Database.Database,
  workspaceId = "org_research",
): WorkspaceProductStatusRow {
  const row = db
    .prepare(
      `SELECT product, status, expires_at, stripe_event_at
       FROM workspace_products
       WHERE workspace_id = ?`,
    )
    .get(workspaceId) as WorkspaceProductStatusRow | undefined;
  if (!row) {
    throw new Error("Expected workspace product row.");
  }
  return row;
}

/** The Stripe linkage columns, which the status row type omits. */
export interface WorkspaceProductStripeRow {
  status: string;
  stripe_customer_id: string | null;
  stripe_event_at: string | null;
  stripe_subscription_id: string | null;
}

/**
 * Reads the Stripe linkage a subscription webhook is supposed to write.
 *
 * @param db - The database the handler wrote to.
 * @param workspaceId - Workspace whose product row to read.
 * @returns The stored row, or undefined when the handler wrote nothing.
 */
export function readWorkspaceProductStripeLinkage(
  db: Database.Database,
  workspaceId: string,
): WorkspaceProductStripeRow | undefined {
  return db
    .prepare(
      `SELECT status, stripe_subscription_id, stripe_customer_id, stripe_event_at
       FROM workspace_products
       WHERE workspace_id = ?`,
    )
    .get(workspaceId) as WorkspaceProductStripeRow | undefined;
}
