import type { DiscountSegment } from "./discount-segments";

/**
 * Defines which tier/interval combinations each segment supports.
 * This makes invalid segment+tier combinations a TypeScript error.
 */
interface SegmentAvailability {
  independent_journalist: ["pro" | "team", "monthly" | "yearly"];
  grassroots_nonprofit: ["team", "monthly" | "yearly"];
  civic_tech_worker: ["pro" | "team", "monthly" | "yearly"];
}

type SupportedTier<S extends DiscountSegment> = SegmentAvailability[S][0];
type SupportedInterval = "monthly" | "yearly";

/**
 * Maps discount segments to environment variable keys for Stripe price IDs.
 * These are populated by the bootstrap script after creating prices in Stripe.
 *
 * TypeScript ensures only valid segment+tier combinations can be accessed.
 */
const DISCOUNT_PRICE_ENV_KEYS = {
  independent_journalist: {
    pro_monthly: "STRIPE_PRICE_INDEPENDENT_JOURNALIST_PRO_MONTHLY",
    pro_yearly: "STRIPE_PRICE_INDEPENDENT_JOURNALIST_PRO_YEARLY",
    team_monthly: "STRIPE_PRICE_INDEPENDENT_JOURNALIST_TEAM_MONTHLY",
    team_yearly: "STRIPE_PRICE_INDEPENDENT_JOURNALIST_TEAM_YEARLY",
  },
  grassroots_nonprofit: {
    team_monthly: "STRIPE_PRICE_GRASSROOTS_NONPROFIT_TEAM_MONTHLY",
    team_yearly: "STRIPE_PRICE_GRASSROOTS_NONPROFIT_TEAM_YEARLY",
  },
  civic_tech_worker: {
    pro_monthly: "STRIPE_PRICE_CIVIC_TECH_PRO_MONTHLY",
    pro_yearly: "STRIPE_PRICE_CIVIC_TECH_PRO_YEARLY",
    team_monthly: "STRIPE_PRICE_CIVIC_TECH_TEAM_MONTHLY",
    team_yearly: "STRIPE_PRICE_CIVIC_TECH_TEAM_YEARLY",
  },
} as const;

/**
 * Get the Stripe price ID for a verified discount customer.
 *
 * TypeScript enforces that only valid segment+tier combinations are allowed.
 * For instance, calling getDiscountPriceId("grassroots_nonprofit", "pro", "monthly")
 * will be a compile error because grassroots nonprofits don't get Pro pricing.
 */
export function getDiscountPriceId<S extends DiscountSegment>(
  segment: S,
  tier: SupportedTier<S>,
  interval: SupportedInterval,
): string | null {
  const key = `${tier}_${interval}` as const;
  const envKey = (DISCOUNT_PRICE_ENV_KEYS[segment] as Record<string, string>)[key];

  if (!envKey) {
    return null; // Shouldn't happen if types are enforced
  }

  return (process.env[envKey] ?? "").trim() || null;
}
