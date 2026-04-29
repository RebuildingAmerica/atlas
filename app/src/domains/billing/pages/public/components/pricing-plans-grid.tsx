import { Link } from "@tanstack/react-router";
import { type BillingPeriod, PlanCard, type PlanCardLinkCta } from "./plan-card";
import {
  type PricingCheckoutInterval,
  type PricingCheckoutParams,
  checkoutKey,
} from "../pricing-page-helpers";

interface PricingPlansGridProps {
  activeWorkspaceName: string | null;
  billing: BillingPeriod;
  freeCta: PlanCardLinkCta;
  pendingCheckoutKey: string | null;
  subscriptionInterval: PricingCheckoutInterval;
  onBillingChange: (period: BillingPeriod) => void;
  onCheckout: (params: PricingCheckoutParams) => Promise<void>;
}

/**
 * Plans section of the pricing page — buying-for hint, monthly/annual
 * toggle, and the three plan cards (Free, Atlas Pro, Atlas Team) with
 * each card's price, feature list, and CTA wired up.
 */
export function PricingPlansGrid({
  activeWorkspaceName,
  billing,
  freeCta,
  pendingCheckoutKey,
  subscriptionInterval,
  onBillingChange,
  onCheckout,
}: PricingPlansGridProps) {
  return (
    <div className="border-border mb-10 border-t pt-8">
      {activeWorkspaceName ? (
        <p className="type-body-small text-ink-muted mb-4">
          Buying for {activeWorkspaceName}.{" "}
          <Link to="/account" className="text-ink-soft hover:text-ink-strong underline">
            Switch in your account
          </Link>
          .
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 sm:gap-4">
        <p className="type-label-medium text-ink-muted tracking-wider uppercase">Plans</p>
        <div className="border-border inline-flex items-center gap-0.5 rounded-full border bg-white px-1 py-1">
          <button
            onClick={() => {
              onBillingChange("monthly");
            }}
            className={`type-label-small rounded-full px-4 py-1.5 font-medium transition-colors ${
              billing === "monthly"
                ? "bg-accent text-white"
                : "text-ink-muted hover:text-ink-strong"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => {
              onBillingChange("annual");
            }}
            className={`type-label-small rounded-full px-4 py-1.5 font-medium transition-colors ${
              billing === "annual" ? "bg-accent text-white" : "text-ink-muted hover:text-ink-strong"
            }`}
          >
            Annual <span className="type-body-small text-accent-soft">— save 20%</span>
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <PlanCard
          planName="Free"
          descriptor="For anyone curious"
          tagline="Browse without an account. Sign up to run research and save shortlists."
          features={[
            "Browse & search (no account)",
            "Read any profile (no account)",
            "Sign up to run 2 research/month",
            "Sign up for 1 shortlist (25 entries)",
            "Public API 100 req/hr",
          ]}
          monthlyPrice="Free"
          billing={billing}
          ctaText={freeCta.label}
          linkCta={freeCta}
        />

        <PlanCard
          planName="Atlas Pro"
          descriptor="For the individual researcher"
          tagline="Journalists, organizers, and creators who use Atlas as a regular part of their work."
          features={[
            "Unlimited research runs",
            "Notes and shortlists",
            "Export to CSV and JSON",
            "API key · 1,000 req/day",
            "MCP and OAuth access",
          ]}
          monthlyPrice={
            <>
              $5<span className="type-body-small text-ink-soft">/month</span>
            </>
          }
          annualPrice={
            <>
              $48<span className="type-body-small text-ink-soft">/year</span>
              <span className="type-label-small bg-surface-container text-accent-deep ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium">
                2 months free
              </span>
            </>
          }
          annualNote="$4/month, billed annually"
          billing={billing}
          ctaText="Get Atlas Pro"
          ctaProduct="atlas_pro"
          ctaInterval={subscriptionInterval}
          onCheckout={onCheckout}
          isPending={pendingCheckoutKey === checkoutKey("atlas_pro", subscriptionInterval)}
          discountNote="Qualified journalists, nonprofits, and civic tech workers get 40–50% off"
        />

        <PlanCard
          planName="Atlas Team"
          descriptor="For newsrooms and nonprofits"
          tagline="Teams that coordinate research — shared workspace, monitoring, and org-level integrations."
          features={[
            "Everything in Atlas Pro",
            "Shared workspace and notes",
            "Watchlists and monitoring digests",
            "Slack integration",
            "SSO (SAML/OIDC) · Up to 50 members",
          ]}
          monthlyPrice={
            <>
              $25<span className="type-body-small text-ink-muted">/month base</span>
              <p className="type-body-small text-ink-muted mt-2">
                + $8/seat/month per additional member
              </p>
            </>
          }
          annualPrice={
            <>
              $250<span className="type-body-small text-ink-muted">/year base</span>
              <span className="type-label-small bg-ink text-accent-soft ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium">
                2 months free
              </span>
              <p className="type-body-small text-ink-muted mt-2">
                + $80/seat/year, billed annually
              </p>
            </>
          }
          billing={billing}
          ctaText="Get Atlas Team"
          ctaProduct="atlas_team"
          ctaInterval={subscriptionInterval}
          onCheckout={onCheckout}
          isPending={pendingCheckoutKey === checkoutKey("atlas_team", subscriptionInterval)}
          discountNote="Qualified nonprofits and newsrooms get 40% off"
          isTeam
        />
      </div>

      <p className="type-body-small text-ink-soft leading-relaxed">
        All plans include full access to the Atlas graph. Professional plans can be cancelled
        anytime.
      </p>
    </div>
  );
}
