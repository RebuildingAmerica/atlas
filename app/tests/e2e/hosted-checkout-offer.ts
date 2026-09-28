/** An offer the hosted checkout proof can open for the signed-in test owner. */
export interface HostedCheckoutOffer {
  product: "atlas_pro" | "atlas_research_pass" | "atlas_team";
  interval: "monthly" | "yearly" | "weekly" | "once";
}

// The student plan is left out: it opens only for a verified student, which
// the hosted test owner is not.
const HOSTED_CHECKOUT_OFFER_PREFERENCE: readonly HostedCheckoutOffer[] = [
  { product: "atlas_pro", interval: "monthly" },
  { product: "atlas_pro", interval: "yearly" },
  { product: "atlas_research_pass", interval: "once" },
  { product: "atlas_research_pass", interval: "weekly" },
  { product: "atlas_team", interval: "monthly" },
  { product: "atlas_team", interval: "yearly" },
];

/**
 * Picks the first offer the deployed allowlist sells, so the proof never
 * fails a release by opening an offer production does not sell.
 */
export function selectHostedCheckoutOffer(allowed: readonly string[]): HostedCheckoutOffer {
  const offer = HOSTED_CHECKOUT_OFFER_PREFERENCE.find((candidate) =>
    allowed.includes(`${candidate.product}:${candidate.interval}`),
  );
  if (!offer) {
    throw new Error(
      `Deployed allowlist [${allowed.join(", ")}] has no offer this proof can open without a verified discount.`,
    );
  }
  return offer;
}
