import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { rememberPendingCheckout } from "@/domains/billing/pending-checkout";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import { PageLayout } from "@/platform/layout/page-layout";
import { useConfirmDialog } from "@/platform/ui/confirm-dialog";
import type { BillingPeriod, PlanCardLinkCta } from "./components/plan-card";
import { PricingComparisonTable } from "./components/pricing-comparison-table";
import { PricingPlansGrid } from "./components/pricing-plans-grid";
import {
  PricingDiscountsCard,
  PricingEnterpriseCard,
  PricingResearchPassCard,
} from "./components/pricing-tail-cards";
import {
  type PricingCheckoutInterval,
  type PricingCheckoutParams,
  checkoutKey,
  describeCheckoutCost,
  loadStartCheckout,
  readCheckoutErrorMessage,
} from "./pricing-page-helpers";

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

interface PricingPageProps {
  intent?: PricingSearch["intent"];
  interval?: PricingCheckoutInterval;
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
export function PricingPage({ intent, interval: intentInterval }: PricingPageProps) {
  const navigate = useNavigate();
  const session = useAtlasSession();
  const { confirm } = useConfirmDialog();
  const [billing, setBilling] = useState<BillingPeriod>("monthly");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [pendingCheckoutKey, setPendingCheckoutKey] = useState<string | null>(null);
  const hasResumedRef = useRef(false);

  async function handleCheckout({ product, interval }: PricingCheckoutParams) {
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
  const subscriptionInterval: PricingCheckoutInterval = billing === "annual" ? "yearly" : "monthly";
  const researchPassInterval: PricingCheckoutInterval = "once";
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

        <PricingPlansGrid
          activeWorkspaceName={activeWorkspace?.name ?? null}
          billing={billing}
          freeCta={freeCta}
          pendingCheckoutKey={pendingCheckoutKey}
          subscriptionInterval={subscriptionInterval}
          onBillingChange={setBilling}
          onCheckout={handleCheckout}
        />

        <PricingResearchPassCard
          pendingCheckoutKey={pendingCheckoutKey}
          researchPassInterval={researchPassInterval}
          onPurchase={() => {
            void handleCheckout({
              product: "atlas_research_pass",
              interval: researchPassInterval,
            });
          }}
        />

        <PricingComparisonTable />
        <PricingEnterpriseCard />
        <PricingDiscountsCard />
      </section>
    </PageLayout>
  );
}
