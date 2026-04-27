import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import type { AtlasProduct } from "@/domains/access/capabilities";
import { PageLayout } from "@/platform/layout/page-layout";
import { Button } from "@/platform/ui/button";

// ---------------------------------------------------------------------------
// Search schema
// ---------------------------------------------------------------------------

/**
 * Search params accepted by the /pricing route.
 *
 * `intent` and `interval` are set when an anonymous user clicked a paid CTA
 * before signing in. After sign-in completes and the magic-link redirect
 * lands them back here, the page auto-resumes the checkout.
 */
export const pricingSearchSchema = z.object({
  intent: z.enum(["atlas_pro", "atlas_team", "atlas_research_pass"]).optional(),
  interval: z.enum(["monthly", "yearly", "once", "weekly"]).optional(),
});

export type PricingSearch = z.infer<typeof pricingSearchSchema>;

// ---------------------------------------------------------------------------
// Checkout handler
// ---------------------------------------------------------------------------

/**
 * Parameters for initiating a checkout flow from the pricing page.
 */
interface CheckoutParams {
  product: AtlasProduct;
  interval: "monthly" | "yearly" | "once" | "weekly";
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type BillingPeriod = "monthly" | "annual";

interface PlanCardProps {
  label: string;
  name: string;
  tagline: string;
  features: string[];
  monthlyPrice: string | ReactNode;
  annualPrice?: string | ReactNode;
  annualNote?: string;
  billing: BillingPeriod;
  ctaText: string;
  ctaProduct?: AtlasProduct;
  ctaInterval?: "monthly" | "yearly" | "once" | "weekly";
  onCheckout?: (params: CheckoutParams) => Promise<void>;
  isTeam?: boolean;
  discountNote?: ReactNode;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PlanCard({
  label,
  name,
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
  isTeam,
  discountNote,
}: PlanCardProps) {
  const isDark = isTeam;
  const bgClass = isDark ? "bg-ink-strong" : "bg-white";
  const borderClass = isDark ? "border-transparent" : "border-border";
  const labelColorClass = isDark ? "text-ink-muted" : "text-ink-muted";
  const nameColorClass = isDark ? "text-surface-container-lowest" : "text-ink-strong";
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
    <div
      className={`${bgClass} ${borderClass} flex flex-col rounded-[1.125rem] border px-5 py-5 sm:rounded-[1.125rem] sm:px-5 sm:py-5`}
    >
      <p className={`${labelColorClass} type-label-small mb-1 tracking-wider uppercase`}>{label}</p>
      <p className={`${nameColorClass} type-title-small mb-2 font-medium`}>{name}</p>
      <p className={`${taglineColorClass} type-body-small mb-4 leading-relaxed`}>{tagline}</p>

      <div
        className={`mb-4 border-t pt-4 ${isDark ? "border-ink-strong" : "border-surface-container"}`}
      >
        <ul className={`${featureColorClass} type-body-small space-y-2`}>
          {features.map((feature, idx) => (
            <li key={idx}>→ {feature}</li>
          ))}
        </ul>
      </div>

      <div className="mb-4 flex-1">
        <p className={`${priceColorClass} text-xl font-semibold`}>{showPrice}</p>
        {annualNote && billing === "annual" && (
          <p className={`${priceSubColorClass} type-body-small mt-1`}>{annualNote}</p>
        )}
      </div>

      {ctaText === "Browse the Atlas" ? (
        <Link to="/browse" className="no-underline">
          <Button variant="secondary" className="w-full justify-center">
            {ctaText}
          </Button>
        </Link>
      ) : (
        <Button
          variant={isTeam ? "ghost" : "primary"}
          className={`w-full justify-center ${isTeam ? "border-ink-strong border" : ""}`}
          onClick={() => void handleCta()}
        >
          {ctaText}
        </Button>
      )}

      {discountNote && (
        <p
          className={`type-body-small mt-3 text-center ${isDark ? "text-ink-soft" : "text-accent"}`}
        >
          {discountNote}
        </p>
      )}

      {isTeam && (
        <p className="type-body-small text-ink-soft mt-3 text-center">
          Setting up a large org?{" "}
          <a
            href="mailto:hello@rebuildingus.org"
            className="text-ink-muted hover:text-ink-strong underline"
          >
            Talk to us
          </a>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PricingPageProps {
  intent?: AtlasProduct;
  interval?: "monthly" | "yearly" | "once" | "weekly";
}

/**
 * Public-facing pricing page.
 *
 * Accessible without authentication. Shows Atlas's three product tiers and
 * a Research Pass option. CTA buttons call startCheckout(), which redirects
 * through Stripe Checkout. Users must be signed in to purchase; unauthenticated
 * users are redirected to /sign-in first.
 *
 * When the page is rendered with `intent`+`interval` search params and the
 * viewer is signed in, checkout is auto-resumed once. This preserves the
 * original CTA when an anonymous user is bounced through sign-in.
 */
function readCheckoutErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Atlas could not start checkout. Try again.";
}

export function PricingPage({ intent, interval: intentInterval }: PricingPageProps) {
  const navigate = useNavigate();
  const session = useAtlasSession();
  const [billing, setBilling] = useState<BillingPeriod>("monthly");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const hasResumedRef = useRef(false);

  async function handleCheckout({ product, interval }: CheckoutParams) {
    // session.data === undefined while the query is still loading; null
    // when resolved to "no session." Only treat the latter as anonymous
    // — otherwise a fast-clicking authed user can be wrongly bounced
    // through sign-in.
    if (session.data === undefined) {
      return;
    }

    if (session.data === null) {
      const params = new URLSearchParams({ intent: product, interval });
      const redirectTarget = `/pricing?${params.toString()}`;
      void navigate({ to: "/sign-in", search: { redirect: redirectTarget } });
      return;
    }

    setCheckoutError(null);

    try {
      const { startCheckout } = await import("@/domains/billing/checkout.functions");
      const result = await startCheckout({ data: { product, interval } });
      window.location.assign(result.url);
    } catch (error) {
      setCheckoutError(readCheckoutErrorMessage(error));
    }
  }

  useEffect(() => {
    if (hasResumedRef.current) {
      return;
    }
    if (!intent || !intentInterval) {
      return;
    }
    if (!session.data) {
      return;
    }

    hasResumedRef.current = true;

    const resume = async () => {
      await navigate({ to: "/pricing", search: {}, replace: true });

      try {
        const { startCheckout } = await import("@/domains/billing/checkout.functions");
        const result = await startCheckout({
          data: { product: intent, interval: intentInterval },
        });
        window.location.assign(result.url);
      } catch (error) {
        setCheckoutError(readCheckoutErrorMessage(error));
        // Allow the operator to retry by clicking a CTA again.
        hasResumedRef.current = false;
      }
    };

    void resume();
  }, [intent, intentInterval, session.data, navigate]);

  return (
    <PageLayout className="py-10 lg:py-16">
      <section className="mx-auto w-full max-w-3xl">
        {/* Lede */}
        <div className="mb-8 sm:mb-10">
          <p className="type-label-medium text-ink-muted mb-3 tracking-wider uppercase">
            How Atlas is funded
          </p>
          <h1 className="type-display-small text-ink-strong mb-4 leading-tight">
            Atlas is free to use. <br />
            Here's how we keep it that way.
          </h1>
          <p className="type-body-large text-ink-soft mb-4 leading-relaxed">
            The costs of running Atlas — the pipeline, the infrastructure, the research tools — are
            covered by researchers, journalists, and organizations who use it professionally. If
            that's you, consider supporting the work.
          </p>
        </div>

        {checkoutError ? (
          <div role="alert" className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="type-body-medium text-red-700">{checkoutError}</p>
          </div>
        ) : null}

        {/* Plans section */}
        <div className="border-border mb-10 border-t pt-8">
          {/* Section label + toggle */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 sm:gap-4">
            <p className="type-label-medium text-ink-muted tracking-wider uppercase">Plans</p>
            <div className="border-border inline-flex items-center gap-0.5 rounded-full border bg-white px-1 py-1">
              <button
                onClick={() => {
                  setBilling("monthly");
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
                  setBilling("annual");
                }}
                className={`type-label-small rounded-full px-4 py-1.5 font-medium transition-colors ${
                  billing === "annual"
                    ? "bg-accent text-white"
                    : "text-ink-muted hover:text-ink-strong"
                }`}
              >
                Annual <span className="type-body-small text-accent-soft">— save 20%</span>
              </button>
            </div>
          </div>

          {/* Plan grid */}
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <PlanCard
              label="Free"
              name="For anyone curious"
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
              ctaText="Browse the Atlas"
            />

            <PlanCard
              label="Atlas Pro"
              name="For the individual researcher"
              tagline="Journalists, organizers, and creators who use Atlas as a regular part of their work."
              features={[
                "Unlimited research runs",
                "Notes and shortlists",
                "Export to CSV and JSON",
                "API key · 1,000 req/day",
                "MCP and OAuth access",
              ]}
              monthlyPrice="$5/month"
              annualPrice={
                <>
                  $48<span className="type-body-small text-ink-soft">/year</span>
                  <span className="bg-surface-container text-accent-deep ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
                    2 months free
                  </span>
                </>
              }
              annualNote="$4/month, billed annually"
              billing={billing}
              ctaText="Get Atlas Pro"
              ctaProduct="atlas_pro"
              ctaInterval={billing === "annual" ? "yearly" : "monthly"}
              onCheckout={handleCheckout}
              discountNote="Qualified journalists, nonprofits, and civic tech workers get 40–50% off"
            />

            <PlanCard
              label="Atlas Team"
              name="For newsrooms and nonprofits"
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
                  $25<span className="type-body-small text-ink-soft">/month base</span>
                  <p className="type-body-small text-ink-soft mt-2">
                    + $8/seat/month per additional member
                  </p>
                </>
              }
              annualPrice={
                <>
                  $250<span className="type-body-small text-ink-soft">/year base</span>
                  <span className="bg-ink-strong text-accent-soft ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
                    2 months free
                  </span>
                  <p className="type-body-small text-ink-soft mt-2">
                    + $80/seat/year, billed annually
                  </p>
                </>
              }
              billing={billing}
              ctaText="Get Atlas Team"
              ctaProduct="atlas_team"
              ctaInterval={billing === "annual" ? "yearly" : "monthly"}
              onCheckout={handleCheckout}
              discountNote="Qualified nonprofits and newsrooms get 40% off"
              isTeam
            />
          </div>

          <p className="type-body-small text-ink-soft leading-relaxed">
            All plans include full access to the Atlas graph. Professional plans can be cancelled
            anytime.
          </p>
        </div>

        {/* Research Pass section */}
        <div className="mb-10">
          <p className="type-label-medium text-ink-muted mb-4 tracking-wider uppercase">
            Project access
          </p>
          <div className="border-border rounded-[1rem] border bg-white p-4 sm:flex sm:items-start sm:gap-5">
            <div className="mb-4 flex-1 sm:mb-0">
              <p className="type-title-small text-ink-strong mb-2 font-medium">
                Atlas Research Pass
              </p>
              <p className="type-body-small text-ink-soft leading-relaxed">
                Full Pro access without a subscription — useful for one-time investigations,
                grant-funded projects, or trying Atlas before committing. Your shortlists and notes
                stay readable after the pass expires.
              </p>
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="type-title-small text-ink-strong mb-1 font-medium">
                $9 <span className="type-body-small text-ink-soft font-normal">/ 30 days</span>
              </p>
              <p className="type-body-small text-ink-soft mb-3">or $4 / 7 days</p>
              <Button
                variant="primary"
                onClick={() => {
                  void handleCheckout({
                    product: "atlas_research_pass",
                    interval: "once",
                  });
                }}
              >
                Get a pass
              </Button>
            </div>
          </div>
        </div>

        {/* Discounts section */}
        <div className="border-border border-t pt-8">
          <p className="type-label-medium text-ink-muted mb-4 tracking-wider uppercase">
            Discounted access
          </p>
          <div className="border-border rounded-[1rem] border bg-white p-5">
            <p className="type-title-small text-ink-strong mb-2 font-medium">
              Are you an independent journalist, grassroots nonprofit, or civic tech worker?
            </p>
            <p className="type-body-small text-ink-soft mb-4 leading-relaxed">
              Atlas offers 40–50% discounts for public-interest researchers and organizations.
              Submit your information and we'll verify your eligibility within 24 hours.
            </p>
            <Link to="/request-discount">
              <Button variant="secondary">Request a discount</Button>
            </Link>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
