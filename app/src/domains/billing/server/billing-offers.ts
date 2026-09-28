import "@tanstack/react-start/server-only";

const CATALOG_OFFERS = [
  "atlas_pro:monthly",
  "atlas_pro:yearly",
  "atlas_pro:four_month",
  "atlas_team:monthly",
  "atlas_team:yearly",
  "atlas_research_pass:weekly",
  "atlas_research_pass:once",
] as const;

const catalogOfferSet = new Set<string>(CATALOG_OFFERS);

export function isProductionBillingRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "production" || (!env.VERCEL_ENV && env.NODE_ENV === "production");
}

/** The exact new-sale combinations supported by the current catalog. */
export function getAllowedBillingOffers(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!isProductionBillingRuntime(env)) {
    return [...CATALOG_OFFERS];
  }

  const raw = env.ATLAS_BILLING_ALLOWED_OFFERS?.trim();
  if (!raw) return [];
  const offers = raw.split(",").map((offer) => offer.trim());
  if (
    offers.some((offer) => !catalogOfferSet.has(offer)) ||
    new Set(offers).size !== offers.length
  ) {
    return [];
  }
  return offers;
}

/** An absent or malformed production allowlist closes every new sale. */
export function isBillingOfferAllowed(product: string, interval: string | undefined): boolean {
  if (!interval) return !isProductionBillingRuntime();
  return getAllowedBillingOffers().includes(`${product}:${interval}`);
}
