import type { PaidAccessDecision, WaitlistProduct } from "./contracts";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
export interface PaidPlanAction {
  kind: "join" | "request" | "purchase" | "account";
  label: string;
  disabled: boolean;
  requestId?: string;
}
export function paidPlanAction(
  access: PaidAccessDecision | undefined,
  product: WaitlistProduct,
  available: boolean,
  activeProducts: readonly string[],
  interval?: string,
): PaidPlanAction {
  if (activeProducts.includes(product))
    return { kind: "account", label: "Manage plan", disabled: false };
  if (!access) return { kind: "purchase", label: "Continue", disabled: true };
  if (access.mode === "waitlist" && !access.admittedProducts.includes(product)) {
    const request = access.requests.find((item) => item.product === product);
    return request
      ? { kind: "request", requestId: request.id, label: "View waitlist request", disabled: false }
      : { kind: "join", label: "Join waitlist", disabled: false };
  }
  const label =
    product === "atlas_research_pass" && interval
      ? interval === "weekly"
        ? "7-day pass"
        : "30-day pass"
      : PRODUCT_LABELS[product];
  return {
    kind: "purchase",
    label: `${access.mode === "open" ? "Get" : "Continue with"} ${label}`,
    disabled: !available,
  };
}
