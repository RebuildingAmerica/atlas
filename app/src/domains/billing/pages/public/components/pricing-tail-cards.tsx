import { Link } from "@tanstack/react-router";
import { Button } from "@/platform/ui/button";
import { checkoutKey, type PricingCheckoutInterval } from "../pricing-page-helpers";

interface ResearchPassCardProps {
  pendingCheckoutKey: string | null;
  researchPassInterval: PricingCheckoutInterval;
  onPurchase: () => void;
}

/**
 * "Project access" card on the pricing surface, exposing the one-time
 * Atlas Research Pass purchase for operators who need full Pro access
 * for a fixed window without committing to a subscription.
 */
export function PricingResearchPassCard({
  pendingCheckoutKey,
  researchPassInterval,
  onPurchase,
}: ResearchPassCardProps) {
  const isPending = pendingCheckoutKey === checkoutKey("atlas_research_pass", researchPassInterval);
  return (
    <div className="mb-10">
      <p className="type-label-medium text-ink-muted mb-4 tracking-wider uppercase">
        Project access
      </p>
      <div className="border-border rounded-[1rem] border bg-white p-4 sm:flex sm:items-start sm:gap-5">
        <div className="mb-4 flex-1 sm:mb-0">
          <p className="type-title-small text-ink-strong mb-2 font-medium">Atlas Research Pass</p>
          <p className="type-body-small text-ink-soft leading-relaxed">
            Full Pro access without a subscription — useful for one-time investigations,
            grant-funded projects, or trying Atlas before committing. Your shortlists and notes stay
            readable after the pass expires.
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="type-title-small text-ink-strong mb-1 font-medium">
            $9 <span className="type-body-small text-ink-soft font-normal">/ 30 days</span>
          </p>
          <p className="type-body-small text-ink-soft mb-3">or $4 / 7 days</p>
          <Button variant="primary" onClick={onPurchase} disabled={isPending}>
            {isPending ? "Opening checkout…" : "Get a pass"}
          </Button>
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
      <div className="border-border rounded-[1rem] border bg-white p-5">
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
 * Discounted-access card pointing public-interest researchers and
 * organisations at the discount-request flow.
 */
export function PricingDiscountsCard() {
  return (
    <div className="border-border border-t pt-8">
      <p className="type-label-medium text-ink-muted mb-4 tracking-wider uppercase">
        Discounted access
      </p>
      <div className="border-border rounded-[1rem] border bg-white p-5">
        <p className="type-title-small text-ink-strong mb-2 font-medium">
          Are you an independent journalist, grassroots nonprofit, or civic tech worker?
        </p>
        <p className="type-body-small text-ink-soft mb-4 leading-relaxed">
          Atlas offers 40–50% discounts for public-interest researchers and organizations. Submit
          your information and we'll verify your eligibility within 24 hours.
        </p>
        <Link to="/request-discount">
          <Button variant="secondary">Request a discount</Button>
        </Link>
      </div>
    </div>
  );
}
