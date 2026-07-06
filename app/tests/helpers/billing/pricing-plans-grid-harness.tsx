import { useState } from "react";
import { PricingPlansGrid } from "@/domains/billing/pages/public/components/pricing-plans-grid";
import type { BillingPeriod } from "@/domains/billing/pages/public/components/plan-card";

async function completeCheckout(): Promise<void> {
  await Promise.resolve();
}

export function PricingPlansGridHarness() {
  const [billing, setBilling] = useState<BillingPeriod>("monthly");
  return (
    <PricingPlansGrid
      activeWorkspaceName={null}
      billing={billing}
      freeCta={{ label: "Create account", to: "/sign-up" }}
      pendingCheckoutKey={null}
      subscriptionInterval={billing === "annual" ? "yearly" : "monthly"}
      onBillingChange={setBilling}
      onCheckout={completeCheckout}
    />
  );
}
