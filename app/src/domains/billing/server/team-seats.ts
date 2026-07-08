import "@tanstack/react-start/server-only";

import type Stripe from "stripe";
import { getStripeClient } from "./stripe-client";
import { getAtlasBillingProducts } from "../products";
import type { AtlasBillingProducts } from "../products";
import type { TeamBillingInterval } from "../team-cost";
import { ensureAuthReady } from "../../access/server/auth";
import { queryActiveTeamSubscriptionId } from "../../access/server/workspace-products";

/**
 * Returns the seat prices Atlas bills for additional Team members.
 */
function seatPriceIds(products: AtlasBillingProducts): Set<string> {
  return new Set(
    [products.atlas_team.monthlySeatPriceId, products.atlas_team.yearlySeatPriceId].filter(Boolean),
  );
}

/**
 * Resolves the seat price matching a subscription's billing interval.
 *
 * The interval is inferred from the recognized base line item; a subscription
 * billed on the yearly base uses the yearly seat price, everything else uses
 * the monthly seat price.
 *
 * @param subscription - The Stripe subscription being reconciled.
 */
function resolveSeatPriceId(
  products: AtlasBillingProducts,
  subscription: Stripe.Subscription,
): string {
  const baseItem = subscription.items.data.find(
    (item) =>
      item.price.id === products.atlas_team.monthlyPriceId ||
      item.price.id === products.atlas_team.yearlyPriceId,
  );
  const isYearly = baseItem?.price.id === products.atlas_team.yearlyPriceId;
  const seatPriceId = isYearly
    ? products.atlas_team.yearlySeatPriceId
    : products.atlas_team.monthlySeatPriceId;
  if (!seatPriceId) {
    throw new Error(
      "Stripe seat price not configured for Atlas Team. Check environment variables.",
    );
  }
  return seatPriceId;
}

/**
 * Synchronizes a workspace's Atlas Team seat billing with its current
 * membership.
 *
 * Each member beyond the one covered by the base price is billed as a seat, so
 * the per-seat line item's quantity is set to `members - 1`. The seat item is
 * created on demand the first time a teammate joins and updated (with
 * proration) thereafter. Stripe is the source of truth for billed seats; this
 * function is idempotent and a no-op when the workspace has no active Team
 * subscription.
 *
 * @param workspaceId - The workspace (organization) ID to reconcile.
 */
export async function syncTeamSeats(workspaceId: string): Promise<void> {
  const subscriptionId = await queryActiveTeamSubscriptionId(workspaceId);
  if (!subscriptionId) {
    return;
  }

  const auth = await ensureAuthReady();
  // Membership is read server-side (no browser session) so the sync works even
  // when triggered by the member who is leaving.
  const fullOrganization = await auth.api.getFullOrganization({
    headers: new Headers(),
    query: { organizationId: workspaceId },
  });
  const memberCount = fullOrganization?.members?.length ?? 0;
  const targetSeats = Math.max(0, memberCount - 1);

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const products = getAtlasBillingProducts();
  const seats = seatPriceIds(products);
  const existingSeatItem = subscription.items.data.find((item) => seats.has(item.price.id));

  if (existingSeatItem) {
    if (targetSeats === 0) {
      // Seat prices are licensed, so the way to stop billing additional seats
      // is to remove the line item — setting quantity to 0 is not valid.
      await stripe.subscriptionItems.del(existingSeatItem.id, {
        proration_behavior: "create_prorations",
      });
    } else if (existingSeatItem.quantity !== targetSeats) {
      await stripe.subscriptionItems.update(existingSeatItem.id, {
        quantity: targetSeats,
        proration_behavior: "create_prorations",
      });
    }
    return;
  }

  if (targetSeats >= 1) {
    await stripe.subscriptionItems.create({
      subscription: subscriptionId,
      price: resolveSeatPriceId(products, subscription),
      quantity: targetSeats,
      proration_behavior: "create_prorations",
    });
  }
}

/**
 * Resolves the billing interval of a workspace's active Atlas Team
 * subscription, defaulting to monthly when none is active yet.
 *
 * @param workspaceId - The workspace (organization) ID to inspect.
 */
export async function resolveActiveTeamBillingInterval(
  workspaceId: string,
): Promise<TeamBillingInterval> {
  const subscriptionId = await queryActiveTeamSubscriptionId(workspaceId);
  if (!subscriptionId) {
    return "monthly";
  }

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const products = getAtlasBillingProducts();
  const baseItem = subscription.items.data.find(
    (item) =>
      item.price.id === products.atlas_team.monthlyPriceId ||
      item.price.id === products.atlas_team.yearlyPriceId,
  );
  return baseItem?.price.id === products.atlas_team.yearlyPriceId ? "yearly" : "monthly";
}
