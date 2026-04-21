import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { AtlasProduct } from "../../access/capabilities";
import { createPortalSession } from "../billing.functions";

/**
 * Human-readable labels for Atlas product identifiers.
 */
const PRODUCT_LABELS: Record<AtlasProduct, string> = {
  atlas_pro: "Atlas Pro",
  atlas_team: "Atlas Team",
  atlas_research_pass: "Research Pass",
};

interface WorkspaceBillingSectionProps {
  activeProducts: AtlasProduct[];
}

/**
 * Billing summary section for the account/workspace settings page.
 *
 * Shows the user's active products, a link to manage their subscription
 * through the Stripe Customer Portal, and an upgrade link to the pricing page.
 */
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
    <div className="border-border bg-surface-container-lowest rounded-[1.5rem] border p-5">
      <div className="space-y-2">
        <h2 className="type-title-large text-ink-strong">Billing</h2>
        <p className="type-body-medium text-ink-soft">
          {hasActiveProducts
            ? "Manage your Atlas subscription and billing details."
            : "You are on the free Default plan."}
        </p>
      </div>

      {hasActiveProducts ? (
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <p className="type-label-medium text-ink-muted">Active products</p>
            <ul className="space-y-1">
              {activeProducts.map((product) => (
                <li key={product} className="type-body-medium text-ink-strong">
                  {PRODUCT_LABELS[product]}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                void handleManageSubscription();
              }}
              disabled={isLoadingPortal}
              className="type-label-large text-ink-strong hover:bg-surface-container-high border-border focus:ring-border-strong rounded-full border bg-transparent px-4 py-2 font-medium transition-[background-color,border-color] duration-150 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
            >
              {isLoadingPortal ? "Opening portal..." : "Manage Subscription"}
            </button>

            <Link
              to="/pricing"
              className="type-label-large text-ink-strong hover:bg-surface-container-high border-border focus:ring-border-strong inline-flex items-center rounded-full border bg-transparent px-4 py-2 font-medium no-underline transition-[background-color,border-color] duration-150 focus:ring-2 focus:ring-offset-2 focus:outline-none"
            >
              Upgrade
            </Link>
          </div>

          {portalError ? <p className="type-body-medium text-ink-strong">{portalError}</p> : null}
        </div>
      ) : (
        <div className="mt-4">
          <Link
            to="/pricing"
            className="type-label-large text-ink-strong underline underline-offset-2"
          >
            Upgrade to Pro or Team
          </Link>
        </div>
      )}
    </div>
  );
}
