import type { AtlasProduct } from "@/domains/access/capabilities";

export type PricingCheckoutInterval = "monthly" | "yearly" | "once" | "weekly";

export interface PricingCheckoutParams {
  product: AtlasProduct;
  interval: PricingCheckoutInterval;
}

/**
 * Readable error string for the checkout error banner.  Falls back to a
 * generic prompt so the operator never sees a stack trace or empty
 * banner.
 */
export function readCheckoutErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Atlas could not start checkout. Try again.";
}

/**
 * Stable key per (product, interval) combination, used as the
 * `pendingCheckoutKey` value so each plan card can independently show
 * its own "Opening checkout…" state.
 */
export function checkoutKey(product: AtlasProduct, interval: PricingCheckoutInterval): string {
  return `${product}:${interval}`;
}

/**
 * Code-split loader for the checkout server function.  Imported lazily
 * so the pricing page render does not pull billing logic into the
 * initial bundle.
 */
export async function loadStartCheckout() {
  const mod = await import("@/domains/billing/checkout.functions");
  return mod.startCheckout;
}

export interface CheckoutCostPreview {
  detailLine: string;
  priceLine: string;
}

/**
 * Builds the human-readable preview Atlas shows in the pre-redirect
 * confirm dialog so the operator can verify the price and cadence
 * before they leave for Stripe.
 */
export function describeCheckoutCost(
  product: AtlasProduct,
  interval: PricingCheckoutInterval,
): CheckoutCostPreview {
  if (product === "atlas_pro") {
    if (interval === "yearly") {
      return {
        priceLine: "$48 per year — about $4 per month.",
        detailLine: "Equivalent to two months free vs monthly billing. Cancel any time.",
      };
    }
    return {
      priceLine: "$5 per month, billed monthly.",
      detailLine: "Cancel any time from the billing portal.",
    };
  }
  if (product === "atlas_team") {
    if (interval === "yearly") {
      return {
        priceLine: "$250 per year base, plus $80 per additional seat per year.",
        detailLine: "Two months free vs monthly billing. Up to 50 members per workspace.",
      };
    }
    return {
      priceLine: "$25 per month base, plus $8 per additional seat per month.",
      detailLine: "Cancel any time. Up to 50 members per workspace.",
    };
  }
  if (interval === "weekly") {
    return {
      priceLine: "$4 for 7 days of access.",
      detailLine: "One-time charge — your shortlists and notes stay readable after the pass ends.",
    };
  }
  return {
    priceLine: "$9 for 30 days of access.",
    detailLine: "One-time charge — your shortlists and notes stay readable after the pass ends.",
  };
}
