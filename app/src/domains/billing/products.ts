/**
 * Atlas product catalog with Stripe price IDs.
 *
 * Server-side only — reads from process.env at runtime. These are NOT
 * available on the client. The pricing page calls a server function that
 * reads these values.
 */

function env(key: string): string {
  return (process.env[key] ?? "").trim();
}

export const ATLAS_PRODUCTS = {
  atlas_pro: {
    monthlyPriceId: env("STRIPE_PRICE_ATLAS_PRO_MONTHLY"),
    yearlyPriceId: env("STRIPE_PRICE_ATLAS_PRO_YEARLY"),
  },
  atlas_team: {
    monthlyPriceId: env("STRIPE_PRICE_ATLAS_TEAM_BASE_MONTHLY"),
    yearlyPriceId: env("STRIPE_PRICE_ATLAS_TEAM_BASE_YEARLY"),
  },
  atlas_research_pass: {
    oncePriceId: env("STRIPE_PRICE_ATLAS_RESEARCH_PASS_ONCE"),
    weeklyPriceId: env("STRIPE_PRICE_ATLAS_RESEARCH_PASS_WEEKLY"),
  },
} as const;
