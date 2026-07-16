import { Link } from "@tanstack/react-router";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { checkoutKey, type PricingCheckoutInterval } from "../pricing-page-helpers";

interface ResearchPassCardProps {
  pendingCheckoutKey: string | null;
  onPurchase: (interval: PricingCheckoutInterval) => void;
}

/**
 * "Project access" card on the pricing surface, exposing the one-time
 * Atlas Research Pass purchase for operators who need Team-level individual
 * access for a fixed window without committing to a subscription.
 */
export function PricingResearchPassCard({ pendingCheckoutKey, onPurchase }: ResearchPassCardProps) {
  const weeklyKey = checkoutKey("atlas_research_pass", "weekly");
  const onceKey = checkoutKey("atlas_research_pass", "once");
  return (
    <div className="mb-10">
      <p className="type-label-medium text-ink-muted mb-4 tracking-wider uppercase">
        Project access
      </p>
      <div className="border-border bg-surface-container-lowest rounded-[1rem] border p-4 sm:flex sm:items-start sm:gap-5">
        <div className="mb-4 flex-1 sm:mb-0">
          <p className="type-title-small text-ink-strong mb-2 font-medium">Atlas Research Pass</p>
          <p className="type-body-small text-ink-soft leading-relaxed">
            Team-level quotas for one person without shared seats, SSO, or SCIM. Useful for one-time
            investigations, grant-funded projects, or trying Atlas before committing. Your
            shortlists and notes stay readable after the pass expires.
          </p>
        </div>
        <div className="grid flex-shrink-0 gap-2 sm:w-44">
          <Button
            variant="secondary"
            onClick={() => {
              onPurchase("weekly");
            }}
            disabled={pendingCheckoutKey === weeklyKey}
          >
            {pendingCheckoutKey === weeklyKey ? "Opening checkout…" : "Get 7-day pass"}
          </Button>
          <p className="type-body-small text-ink-soft text-center">$4</p>
          <Button
            variant="primary"
            onClick={() => {
              onPurchase("once");
            }}
            disabled={pendingCheckoutKey === onceKey}
          >
            {pendingCheckoutKey === onceKey ? "Opening checkout…" : "Get 30-day pass"}
          </Button>
          <p className="type-body-small text-ink-soft text-center">$9</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Enterprise contact card — for newsrooms / foundations / government
 * teams that need annual invoicing, security review, or a custom
 * contract.  Surfaces a mailto with a structured subject so inbound
 * mail can route automatically.
 */
export function PricingEnterpriseCard() {
  return (
    <div className="border-border mb-10 border-t pt-8">
      <p className="type-label-medium text-ink-muted mb-4 tracking-wider uppercase">Enterprise</p>
      <div className="border-border bg-surface-container-lowest rounded-[1rem] border p-5">
        <p className="type-title-small text-ink-strong mb-2 font-medium">
          Need annual invoicing, a security review, or a custom contract?
        </p>
        <p className="type-body-small text-ink-soft mb-4 leading-relaxed">
          We work with newsrooms, foundations, and government teams that prefer annual invoices,
          purchase orders, or signed terms. Email us and we'll route you to someone who can help.
        </p>
        <a
          href="mailto:hello@rebuildingus.org?subject=Atlas%20enterprise%20invoicing"
          className="type-label-large text-ink-strong hover:bg-surface-container-high border-border focus:ring-border-strong inline-flex items-center rounded-full border bg-transparent px-4 py-2 font-medium no-underline transition-[background-color,border-color] duration-150 focus:ring-2 focus:ring-offset-2 focus:outline-none"
        >
          Contact sales
        </a>
      </div>
    </div>
  );
}

/**
 * Discounted-access card pointing eligible individuals and civic workers at
 * the discount-request flow.
 */
export function PricingDiscountsCard() {
  return (
    <div className="border-border border-t pt-8">
      <p className="type-label-medium text-ink-muted mb-4 tracking-wider uppercase">
        Discounted access
      </p>
      <div className="border-border bg-surface-container-lowest rounded-[1rem] border p-5">
        <p className="type-title-small text-ink-strong mb-2 font-medium">
          Are you a student, independent creator, journalist, nonprofit, or civic technologist?
        </p>
        <p className="type-body-small text-ink-soft mb-4 leading-relaxed">
          Verified students pay $12.80 every four months. Independent creators, journalists,
          grassroots nonprofits, and civic tech workers can request discounted Pro access.
        </p>
        <Link to="/request-discount">
          <Button variant="secondary">Request a discount</Button>
        </Link>
      </div>
    </div>
  );
}
