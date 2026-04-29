import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { AtlasProduct } from "@/domains/access/capabilities";
import { Button } from "@/platform/ui/button";
import type { PricingCheckoutInterval, PricingCheckoutParams } from "../pricing-page-helpers";

export type BillingPeriod = "monthly" | "annual";

export interface PlanCardLinkCta {
  label: string;
  to: string;
}

interface PlanCardProps {
  planName: string;
  descriptor: string;
  tagline: string;
  features: string[];
  monthlyPrice: string | ReactNode;
  annualPrice?: string | ReactNode;
  annualNote?: string;
  billing: BillingPeriod;
  ctaText: string;
  ctaProduct?: AtlasProduct;
  ctaInterval?: PricingCheckoutInterval;
  onCheckout?: (params: PricingCheckoutParams) => Promise<void>;
  isPending?: boolean;
  linkCta?: PlanCardLinkCta;
  isTeam?: boolean;
  discountNote?: ReactNode;
}

const PLAN_BUTTON_BASE_CLASSES =
  "type-label-large active:translate-y-px flex w-full cursor-pointer items-center justify-center rounded-full border px-4 py-2.5 font-medium no-underline transition-[color,background-color,border-color,transform] duration-150 ease-out focus:ring-2 focus:ring-offset-2 focus:ring-offset-transparent focus:outline-none";

const SECONDARY_LINK_BUTTON_CLASSES = `${PLAN_BUTTON_BASE_CLASSES} border-outline-variant bg-surface-container-lowest text-on-surface hover:border-outline hover:bg-surface-container-high focus:ring-border-strong`;

const TEAM_CTA_CLASSES = `${PLAN_BUTTON_BASE_CLASSES} border-transparent bg-surface-container-lowest text-ink-strong hover:bg-surface-container-high focus:ring-surface-container-lowest`;

/**
 * Single plan card on the pricing surface.  Renders the plan name,
 * descriptor, tagline, feature list, price (switching between monthly
 * and annual), and the CTA button or link.  Dark variant kicks in for
 * the Atlas Team card via `isTeam`.
 */
export function PlanCard({
  planName,
  descriptor,
  tagline,
  features,
  monthlyPrice,
  annualPrice,
  annualNote,
  billing,
  ctaText,
  ctaProduct,
  ctaInterval,
  onCheckout,
  isPending,
  linkCta,
  isTeam,
  discountNote,
}: PlanCardProps) {
  const isDark = isTeam;
  const bgClass = isDark ? "bg-ink-strong" : "bg-white";
  const borderClass = isDark ? "border-transparent" : "border-border";
  const planNameColorClass = isDark ? "text-surface-container-lowest" : "text-ink-strong";
  const descriptorColorClass = isDark ? "text-ink-muted" : "text-ink-soft";
  const taglineColorClass = isDark ? "text-ink-muted" : "text-ink-soft";
  const featureColorClass = isDark ? "text-ink-muted" : "text-ink-strong";
  const priceColorClass = isDark ? "text-surface-container-lowest" : "text-ink-strong";
  const priceSubColorClass = isDark ? "text-ink-muted" : "text-ink-soft";

  const showPrice = billing === "monthly" ? monthlyPrice : annualPrice || monthlyPrice;

  const handleCta = async () => {
    if (ctaProduct && ctaInterval && onCheckout) {
      await onCheckout({ product: ctaProduct, interval: ctaInterval });
    }
  };

  return (
    <div className={`${bgClass} ${borderClass} flex flex-col rounded-[1.125rem] border px-5 py-5`}>
      <p className={`${planNameColorClass} type-title-large mb-1 font-medium`}>{planName}</p>
      <p className={`${descriptorColorClass} type-body-medium mb-2`}>{descriptor}</p>
      <p className={`${taglineColorClass} type-body-small mb-4 leading-relaxed`}>{tagline}</p>

      <div
        className={`mb-4 flex-1 border-t pt-4 ${isDark ? "border-ink" : "border-surface-container"}`}
      >
        <ul className={`${featureColorClass} type-body-small space-y-2`}>
          {features.map((feature, idx) => (
            <li key={idx}>→ {feature}</li>
          ))}
        </ul>
      </div>

      <div className="mb-4">
        <p className={`${priceColorClass} type-title-medium font-medium`}>{showPrice}</p>
        {annualNote && billing === "annual" && (
          <p className={`${priceSubColorClass} type-body-small mt-1`}>{annualNote}</p>
        )}
      </div>

      {linkCta ? (
        <Link to={linkCta.to} className={SECONDARY_LINK_BUTTON_CLASSES}>
          {linkCta.label}
        </Link>
      ) : isTeam ? (
        <button
          type="button"
          onClick={() => void handleCta()}
          disabled={isPending}
          className={`${TEAM_CTA_CLASSES} ${isPending ? "cursor-not-allowed opacity-50" : ""}`}
        >
          {isPending ? "Opening checkout…" : ctaText}
        </button>
      ) : (
        <Button
          variant="primary"
          className="w-full justify-center"
          onClick={() => void handleCta()}
          disabled={isPending}
        >
          {isPending ? "Opening checkout…" : ctaText}
        </Button>
      )}

      {discountNote && (
        <p
          className={`type-body-small mt-3 text-center ${isDark ? "text-ink-muted" : "text-ink-soft"}`}
        >
          {discountNote}
        </p>
      )}

      {isTeam && (
        <p className="type-body-small text-ink-muted mt-3 text-center">
          Setting up a large org?{" "}
          <a
            href="mailto:hello@rebuildingus.org"
            className="text-ink-soft hover:text-surface-container-lowest underline"
          >
            Talk to us
          </a>
        </p>
      )}
    </div>
  );
}
