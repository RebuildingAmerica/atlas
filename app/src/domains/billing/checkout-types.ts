import type { AtlasSelfServeProduct } from "@/domains/access/capabilities";

export type PricingCheckoutInterval = "monthly" | "yearly" | "four_month" | "once" | "weekly";

export interface PricingCheckoutParams {
  product: AtlasSelfServeProduct;
  interval: PricingCheckoutInterval;
}
