import type Database from "better-sqlite3";
import type Stripe from "stripe";
import type { WorkspaceProductStatusRow } from "@/domains/access/server/workspace-products";

export interface ResearchPassCheckoutEventOptions {
  created: number;
  interval: "once" | "weekly";
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
