import type { AtlasSelfServeProduct } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
export type {
  PricingCheckoutInterval,
  PricingCheckoutParams,
} from "@/domains/billing/checkout-intervals";
import type { PricingCheckoutInterval } from "@/domains/billing/checkout-intervals";

/**
 * Readable error string for the checkout error banner.  Only a message
 * written for the buyer is shown, so the banner never names an environment
 * variable, a Stripe error, or an empty string.
 */
export function readCheckoutErrorMessage(error: unknown): string {
  return userFacingErrorMessage(error, "Atlas could not start checkout. Try again.");
}

/**
 * Stable key per (product, interval) combination, used as the
 * `pendingCheckoutKey` value so each plan card can independently show
 * its own "Opening checkout…" state.
 */
export function checkoutKey(
  product: AtlasSelfServeProduct,
  interval: PricingCheckoutInterval,
): string {
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
  product: AtlasSelfServeProduct,
  interval: PricingCheckoutInterval,
): CheckoutCostPreview {
  if (product === "atlas_pro") {
    if (interval === "four_month") {
      return {
        priceLine: "$12.80 every four months after student verification.",
        detailLine: "This is 80% of the annual Pro rate, split into three payments per year.",
      };
    }
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
