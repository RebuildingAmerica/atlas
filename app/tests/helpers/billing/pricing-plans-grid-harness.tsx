import { useState } from "react";
import { PricingPlansGrid } from "@/domains/billing/pages/public/components/pricing-plans-grid";
import type { BillingPeriod } from "@/domains/billing/pages/public/components/plan-card";
import type { PricingCheckoutParams } from "@/domains/billing/pages/public/pricing-page-helpers";

interface PricingPlansGridHarnessProps {
  onCheckout?: (params: PricingCheckoutParams) => Promise<void>;
  isCheckoutUnavailable?: boolean;
}

async function completeCheckout(): Promise<void> {
  await Promise.resolve();
}

export function PricingPlansGridHarness({
  onCheckout = completeCheckout,
  isCheckoutUnavailable = false,
}: PricingPlansGridHarnessProps) {
  const [billing, setBilling] = useState<BillingPeriod>("monthly");
  return (
    <PricingPlansGrid
      activeWorkspaceName={null}
      billing={billing}
      freeCta={{ label: "Create account", to: "/sign-up" }}
      pendingCheckoutKey={null}
      isCheckoutUnavailable={isCheckoutUnavailable}
      allowedOffers={[
        "atlas_pro:monthly",
        "atlas_pro:yearly",
        "atlas_pro:four_month",
        "atlas_team:monthly",
        "atlas_team:yearly",
      ]}
      proCheckoutInterval={
        billing === "student" ? "four_month" : billing === "annual" ? "yearly" : "monthly"
      }
      teamCheckoutInterval={billing === "annual" ? "yearly" : "monthly"}
      onBillingChange={setBilling}
      onCheckout={onCheckout}
    />
  );
}
