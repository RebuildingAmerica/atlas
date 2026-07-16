import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AccountRow,
  AccountSurface,
} from "@/domains/access/pages/workspace/components/account/rows";
import type { AtlasProduct } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import { createPortalSession } from "../billing.functions";
import { PRODUCT_LABELS } from "../product-labels";

interface WorkspaceBillingSectionProps {
  activeProducts: AtlasProduct[];
}

export function WorkspaceBillingSection({ activeProducts }: WorkspaceBillingSectionProps) {
  const [isLoadingPortal, setIsLoadingPortal] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  async function handleManageSubscription() {
    setPortalError(null);
    setIsLoadingPortal(true);

    try {
      const result = await createPortalSession();
      window.location.assign(result.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open billing portal.";
      setPortalError(message);
    } finally {
      setIsLoadingPortal(false);
    }
  }

  const hasActiveProducts = activeProducts.length > 0;

  return (
    <div className="space-y-4">
      <h2 className="type-title-large text-ink-strong">Billing</h2>

      {hasActiveProducts ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <h3 className="type-title-medium text-ink-strong">Products</h3>
            <AccountSurface>
              {activeProducts.map((product) => (
                <AccountRow key={product} label="Product" value={PRODUCT_LABELS[product]} />
              ))}
            </AccountSurface>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                void handleManageSubscription();
              }}
              disabled={isLoadingPortal}
              className="type-label-large text-ink-strong hover:bg-surface-container-high focus:ring-border-strong bg-surface-container rounded-full px-4 py-2 font-medium transition-[background-color] duration-150 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
            >
              {isLoadingPortal ? "Opening..." : "Manage subscription"}
            </button>

            <Link
              to="/pricing"
              className="type-label-large text-ink-strong hover:bg-surface-container-high focus:ring-border-strong bg-surface-container inline-flex items-center rounded-full px-4 py-2 font-medium no-underline transition-[background-color] duration-150 focus:ring-2 focus:ring-offset-2 focus:outline-none"
            >
              Upgrade
            </Link>
          </div>

          {portalError ? <p className="type-body-medium text-ink-strong">{portalError}</p> : null}
        </div>
      ) : (
        <AccountSurface>
          <AccountRow
            label="Plan"
            value="Free"
            action={
              <Link
                to="/pricing"
                className="type-label-large text-ink-strong underline underline-offset-2"
              >
                Upgrade
              </Link>
            }
          />
        </AccountSurface>
      )}
    </div>
  );
}
