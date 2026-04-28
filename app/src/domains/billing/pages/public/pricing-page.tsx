import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import type { AtlasProduct } from "@/domains/access/capabilities";
import { rememberPendingCheckout } from "@/domains/billing/pending-checkout";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import { PageLayout } from "@/platform/layout/page-layout";
import { Button } from "@/platform/ui/button";
import { useConfirmDialog } from "@/platform/ui/confirm-dialog";

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

interface PlanCardLinkCta {
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
  ctaInterval?: "monthly" | "yearly" | "once" | "weekly";
  onCheckout?: (params: CheckoutParams) => Promise<void>;
  isPending?: boolean;
  linkCta?: PlanCardLinkCta;
  isTeam?: boolean;
  discountNote?: ReactNode;
}

const PLAN_BUTTON_BASE_CLASSES =
  "type-label-large active:translate-y-px flex w-full cursor-pointer items-center justify-center rounded-full border px-4 py-2.5 font-medium no-underline transition-[color,background-color,border-color,transform] duration-150 ease-out focus:ring-2 focus:ring-offset-2 focus:ring-offset-transparent focus:outline-none";

const SECONDARY_LINK_BUTTON_CLASSES = `${PLAN_BUTTON_BASE_CLASSES} border-outline-variant bg-surface-container-lowest text-on-surface hover:border-outline hover:bg-surface-container-high focus:ring-border-strong`;

const TEAM_CTA_CLASSES = `${PLAN_BUTTON_BASE_CLASSES} border-transparent bg-surface-container-lowest text-ink-strong hover:bg-surface-container-high focus:ring-surface-container-lowest`;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PlanCard({
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

function checkoutKey(product: AtlasProduct, interval: CheckoutParams["interval"]): string {
  return `${product}:${interval}`;
}

async function loadStartCheckout() {
  const mod = await import("@/domains/billing/checkout.functions");
  return mod.startCheckout;
}

interface CheckoutCostPreview {
  detailLine: string;
  priceLine: string;
}

/**
 * Builds the human-readable preview Atlas shows in the pre-redirect confirm
 * dialog so the operator can verify the price and cadence before they leave
 * for Stripe.
 *
 * @param product - The product the operator is buying.
 * @param interval - The billing interval the operator picked.
 */
function describeCheckoutCost(
  product: AtlasProduct,
  interval: CheckoutParams["interval"],
): CheckoutCostPreview {
  if (product === "atlas_pro") {
    if (interval === "yearly") {
      return {
        priceLine: "$48 per year — about $4 per month.",
        detailLine: "Equivalent to two months free vs monthly billing. Cancel any time.",
      };
    }
    return {
      priceLine: "$5 per month, billed monthly.",
      detailLine: "Cancel any time from the billing portal.",
    };
  }
  if (product === "atlas_team") {
    if (interval === "yearly") {
      return {
        priceLine: "$250 per year base, plus $80 per additional seat per year.",
        detailLine: "Two months free vs monthly billing. Up to 50 members per workspace.",
      };
    }
    return {
      priceLine: "$25 per month base, plus $8 per additional seat per month.",
      detailLine: "Cancel any time. Up to 50 members per workspace.",
    };
  }
  if (interval === "weekly") {
    return {
      priceLine: "$4 for 7 days of access.",
      detailLine: "One-time charge — your shortlists and notes stay readable after the pass ends.",
    };
  }
  return {
    priceLine: "$9 for 30 days of access.",
    detailLine: "One-time charge — your shortlists and notes stay readable after the pass ends.",
  };
}

interface ComparisonFeatureRow {
  feature: string;
  free: ReactNode;
  pro: ReactNode;
  team: ReactNode;
}

const COMPARISON_TABLE: readonly ComparisonFeatureRow[] = [
  { feature: "Browse and search the Atlas", free: "✓", pro: "✓", team: "✓" },
  { feature: "Read any profile", free: "✓", pro: "✓", team: "✓" },
  { feature: "Discovery runs", free: "2 / month", pro: "Unlimited", team: "Unlimited" },
  {
    feature: "Shortlists",
    free: "1 list, 25 entries",
    pro: "Unlimited",
    team: "Shared, unlimited",
  },
  { feature: "CSV / JSON export", free: "—", pro: "✓", team: "✓" },
  { feature: "Public API", free: "100 / hour", pro: "1,000 / day key", team: "1,000 / day key" },
  { feature: "OAuth & MCP access", free: "—", pro: "✓", team: "✓" },
  { feature: "Watchlists & monitoring digests", free: "—", pro: "—", team: "✓" },
  { feature: "Slack integration", free: "—", pro: "—", team: "✓" },
  { feature: "Single Sign-On (SAML / OIDC)", free: "—", pro: "—", team: "Up to 50 members" },
  {
    feature: "Member management",
    free: "—",
    pro: "—",
    team: "Owner / admin / member roles",
  },
] as const;

export function PricingPage({ intent, interval: intentInterval }: PricingPageProps) {
  const navigate = useNavigate();
  const session = useAtlasSession();
  const { confirm } = useConfirmDialog();
  const [billing, setBilling] = useState<BillingPeriod>("monthly");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [pendingCheckoutKey, setPendingCheckoutKey] = useState<string | null>(null);
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

    const preview = describeCheckoutCost(product, interval);
    const acknowledged = await confirm({
      body: (
        <div className="space-y-2">
          <p>
            Atlas will redirect you to Stripe to complete the {PRODUCT_LABELS[product]} purchase.
          </p>
          <p className="text-on-surface font-medium">{preview.priceLine}</p>
          <p className="type-body-small text-outline">{preview.detailLine}</p>
        </div>
      ),
      cancelLabel: "Not now",
      confirmLabel: "Continue to checkout",
      title: `Confirm ${PRODUCT_LABELS[product]} purchase`,
    });
    if (!acknowledged) {
      return;
    }

    setCheckoutError(null);
    setPendingCheckoutKey(checkoutKey(product, interval));

    try {
      const startCheckout = await loadStartCheckout();
      const result = await startCheckout({ data: { product, interval } });
      rememberPendingCheckout({ product, interval });
      window.location.assign(result.url);
    } catch (error) {
      setCheckoutError(readCheckoutErrorMessage(error));
      setPendingCheckoutKey(null);
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
      setPendingCheckoutKey(checkoutKey(intent, intentInterval));
      await navigate({ to: "/pricing", search: {}, replace: true });

      try {
        const startCheckout = await loadStartCheckout();
        const result = await startCheckout({
          data: { product: intent, interval: intentInterval },
        });
        window.location.assign(result.url);
      } catch (error) {
        setCheckoutError(readCheckoutErrorMessage(error));
        setPendingCheckoutKey(null);
        // Allow the operator to retry by clicking a CTA again.
        hasResumedRef.current = false;
      }
    };

    void resume();
  }, [intent, intentInterval, session.data, navigate]);

  const activeWorkspace = session.data?.workspace.activeOrganization ?? null;
  const isAuthed = Boolean(session.data);
  const subscriptionInterval: CheckoutParams["interval"] =
    billing === "annual" ? "yearly" : "monthly";
  const researchPassInterval: CheckoutParams["interval"] = "once";
  const freeCta: PlanCardLinkCta = isAuthed
    ? { label: "Open your workspace", to: "/discovery" }
    : { label: "Browse the Atlas", to: "/browse" };

  // Auto-resume handoff: when the page is rendered with intent params and a
  // live session, render a deliberate "taking you to checkout" view instead
  // of the plan grid. Eliminates the brief flash of pricing cards before
  // the redirect fires. If the resume errors (and clears the ref), we drop
  // back to the full page so the operator can retry.
  if (
    intent !== undefined &&
    intentInterval !== undefined &&
    session.data &&
    checkoutError === null
  ) {
    const productLabel = PRODUCT_LABELS[intent];
    return (
      <PageLayout className="py-10 lg:py-16">
        <section className="mx-auto w-full max-w-3xl">
          <div className="mb-2">
            <p className="type-label-medium text-ink-muted mb-3 tracking-wider uppercase">
              {productLabel}
            </p>
            <h1 className="type-display-small text-ink-strong mb-4 leading-tight">
              Taking you to checkout
            </h1>
            <p className="type-body-large text-ink-soft leading-relaxed">
              We're getting your purchase ready. You'll be on the payment screen in a moment.
            </p>
          </div>
        </section>
      </PageLayout>
    );
  }

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
          {activeWorkspace ? (
            <p className="type-body-small text-ink-muted mb-4">
              Buying for {activeWorkspace.name}.{" "}
              <Link to="/account" className="text-ink-soft hover:text-ink-strong underline">
                Switch in your account
              </Link>
              .
            </p>
          ) : null}

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
              onCheckout={handleCheckout}
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
              onCheckout={handleCheckout}
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
                    interval: researchPassInterval,
                  });
                }}
                disabled={
                  pendingCheckoutKey === checkoutKey("atlas_research_pass", researchPassInterval)
                }
              >
                {pendingCheckoutKey === checkoutKey("atlas_research_pass", researchPassInterval)
                  ? "Opening checkout…"
                  : "Get a pass"}
              </Button>
            </div>
          </div>
        </div>

        {/* Comparison table */}
        <div className="border-border mb-10 border-t pt-8">
          <p className="type-label-medium text-ink-muted mb-4 tracking-wider uppercase">
            Compare plans
          </p>
          <div className="border-border overflow-x-auto rounded-[1rem] border bg-white">
            <table className="w-full text-left">
              <thead>
                <tr className="border-border border-b">
                  <th className="type-label-medium text-ink-muted px-4 py-3 font-medium">
                    Feature
                  </th>
                  <th className="type-label-medium text-ink-muted px-4 py-3 font-medium">Free</th>
                  <th className="type-label-medium text-ink-muted px-4 py-3 font-medium">
                    Atlas Pro
                  </th>
                  <th className="type-label-medium text-ink-muted px-4 py-3 font-medium">
                    Atlas Team
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_TABLE.map((row, idx) => (
                  <tr
                    key={row.feature}
                    className={idx === COMPARISON_TABLE.length - 1 ? "" : "border-border border-b"}
                  >
                    <td className="type-body-small text-ink-strong px-4 py-3 font-medium">
                      {row.feature}
                    </td>
                    <td className="type-body-small text-ink-soft px-4 py-3">{row.free}</td>
                    <td className="type-body-small text-ink-soft px-4 py-3">{row.pro}</td>
                    <td className="type-body-small text-ink-soft px-4 py-3">{row.team}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Enterprise contact */}
        <div className="border-border mb-10 border-t pt-8">
          <p className="type-label-medium text-ink-muted mb-4 tracking-wider uppercase">
            Enterprise
          </p>
          <div className="border-border rounded-[1rem] border bg-white p-5">
            <p className="type-title-small text-ink-strong mb-2 font-medium">
              Need annual invoicing, a security review, or a custom contract?
            </p>
            <p className="type-body-small text-ink-soft mb-4 leading-relaxed">
              We work with newsrooms, foundations, and government teams that prefer annual invoices,
              purchase orders, or signed terms. Email us and we'll route you to someone who can
              help.
            </p>
            <a
              href="mailto:hello@rebuildingus.org?subject=Atlas%20enterprise%20invoicing"
              className="type-label-large text-ink-strong hover:bg-surface-container-high border-border focus:ring-border-strong inline-flex items-center rounded-full border bg-transparent px-4 py-2 font-medium no-underline transition-[background-color,border-color] duration-150 focus:ring-2 focus:ring-offset-2 focus:outline-none"
            >
              Contact sales
            </a>
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
