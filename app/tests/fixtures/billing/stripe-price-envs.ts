/**
 * Stripe price ID environment variable fixtures used when exercising the
 * billing checkout server function.  Each key matches an env Atlas reads
 * through `ATLAS_PRODUCTS`.
 */
export const STRIPE_PRICE_ENVS = {
  STRIPE_PRICE_ATLAS_PRO_MONTHLY: "price_pro_monthly",
  STRIPE_PRICE_ATLAS_PRO_YEARLY: "price_pro_yearly",
  STRIPE_PRICE_ATLAS_TEAM_BASE_MONTHLY: "price_team_monthly",
  STRIPE_PRICE_ATLAS_TEAM_BASE_YEARLY: "price_team_yearly",
  STRIPE_PRICE_ATLAS_RESEARCH_PASS_ONCE: "price_pass_once",
  STRIPE_PRICE_ATLAS_RESEARCH_PASS_WEEKLY: "price_pass_weekly",
} as const;
