import { WorkspaceBillingSection } from "@/domains/billing/components/workspace-billing-section";
import type { AtlasProduct } from "@rebuildingamerica/atlas-access/workspace/capabilities";

interface AccountBillingSectionProps {
  activeProducts: AtlasProduct[];
  role: string | null;
}

export function AccountBillingSection({ activeProducts, role }: AccountBillingSectionProps) {
  return (
    <section id="billing" className="scroll-mt-28">
      <WorkspaceBillingSection activeProducts={activeProducts} role={role} />
    </section>
  );
}
