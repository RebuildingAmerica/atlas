import { z } from "zod";

/**
 * Billing intervals Atlas Team subscriptions can run on.
 */
export const teamBillingIntervalSchema = z.enum(["monthly", "yearly"]);
export type TeamBillingInterval = z.infer<typeof teamBillingIntervalSchema>;

interface TeamIntervalPricing {
  baseCents: number;
  perSeatCents: number;
}

/**
 * Atlas Team list prices in USD cents. These are the same public amounts shown
 * on the pricing page; the base price covers the owner and each additional
 * member is billed as one seat.
 */
export const ATLAS_TEAM_PRICING: Record<TeamBillingInterval, TeamIntervalPricing> = {
  monthly: { baseCents: 2500, perSeatCents: 800 },
  yearly: { baseCents: 25000, perSeatCents: 8000 },
};

/** Maximum members on an Atlas Team workspace; mirrors TEAM_LIMITS.max_members. */
export const ATLAS_TEAM_MAX_MEMBERS = 50;

/**
 * Seat usage and recurring-cost summary for an Atlas Team workspace.
 */
export interface TeamSeatCostSummary {
  interval: TeamBillingInterval;
  seatsUsed: number;
  maxSeats: number;
  additionalSeats: number;
  baseCents: number;
  perSeatCents: number;
  additionalSeatsCents: number;
  totalCents: number;
}

/**
 * Validates a serialized seat-cost summary crossing the server/client boundary.
 */
export const teamSeatCostSummarySchema = z.object({
  interval: teamBillingIntervalSchema,
  seatsUsed: z.number().int().nonnegative(),
  maxSeats: z.number().int().positive(),
  additionalSeats: z.number().int().nonnegative(),
  baseCents: z.number().int().nonnegative(),
  perSeatCents: z.number().int().nonnegative(),
  additionalSeatsCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
});

/**
 * Computes the recurring Atlas Team cost: base (covering the owner) plus one
 * billed seat per additional member. Member counts are clamped to [0, max] so
 * the displayed cost never exceeds what Stripe will bill.
 *
 * @param memberCount - The current number of workspace members.
 * @param interval - The billing interval to price against.
 */
export function computeTeamSeatCostSummary(
  memberCount: number,
  interval: TeamBillingInterval,
): TeamSeatCostSummary {
  const { baseCents, perSeatCents } = ATLAS_TEAM_PRICING[interval];
  const seatsUsed = Math.min(Math.max(memberCount, 0), ATLAS_TEAM_MAX_MEMBERS);
  const additionalSeats = Math.max(0, seatsUsed - 1);
  const additionalSeatsCents = additionalSeats * perSeatCents;
  return {
    interval,
    seatsUsed,
    maxSeats: ATLAS_TEAM_MAX_MEMBERS,
    additionalSeats,
    baseCents,
    perSeatCents,
    additionalSeatsCents,
    totalCents: baseCents + additionalSeatsCents,
  };
}

/**
 * Formats USD cents as a dollar string, omitting a trailing ".00".
 *
 * @param cents - The amount in USD cents.
 */
export function formatUsdFromCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * Returns the cadence label ("per month" / "per year") for an interval.
 *
 * @param interval - The billing interval.
 */
export function intervalCadenceLabel(interval: TeamBillingInterval): string {
  return interval === "yearly" ? "per year" : "per month";
}

/**
 * Returns the "N of 50 seats used" copy for a seat-cost summary.
 *
 * @param summary - The seat-cost summary to describe.
 */
export function describeSeatsUsed(summary: TeamSeatCostSummary): string {
  return `${summary.seatsUsed} of ${summary.maxSeats} seats used`;
}
