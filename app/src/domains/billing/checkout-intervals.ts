import type { AtlasSelfServeProduct } from "@rebuildingamerica/atlas-access/workspace/capabilities";

export const PRICING_CHECKOUT_INTERVALS = [
  "monthly",
  "yearly",
  "four_month",
  "once",
  "weekly",
] as const;

export type PricingCheckoutInterval = (typeof PRICING_CHECKOUT_INTERVALS)[number];

export interface PricingCheckoutParams {
  product: AtlasSelfServeProduct;
  interval: PricingCheckoutInterval;
}
