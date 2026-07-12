import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { PageLayout } from "@/platform/layout/page-layout";
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
  interval: z.enum(["monthly", "yearly", "four_month", "once", "weekly"]).optional(),
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
  const [billing, setBilling] = useState<BillingPeriod>("monthly");
  const [pendingCheckoutKey, setPendingCheckoutKey] = useState<string | null>(null);

  async function handleCheckout({ product, interval }: PricingCheckoutParams) {
    setPendingCheckoutKey(checkoutKey(product, interval));
    try {
      await navigate({ to: "/start", search: { product, interval } });
    } finally {
      setPendingCheckoutKey(null);
    }
  }

  useEffect(() => {
    if (!intent || !intentInterval) {
      return;
    }
    void navigate({ to: "/start", search: { product: intent, interval: intentInterval } });
  }, [intent, intentInterval, navigate]);

  const activeWorkspace = session.data?.workspace.activeOrganization ?? null;
  const isAuthed = Boolean(session.data);
  const proCheckoutInterval: PricingCheckoutInterval =
    billing === "student" ? "four_month" : billing === "annual" ? "yearly" : "monthly";
  const teamCheckoutInterval: PricingCheckoutInterval = billing === "annual" ? "yearly" : "monthly";
  const freeCta: PlanCardLinkCta = isAuthed
    ? { label: "Open your workspace", to: "/discovery" }
    : { label: "Browse the Atlas", to: "/browse" };

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
            covered by researchers, journalists, and organizations using it in paid work. If Atlas
            supports funded work for you or your organization, that use should help keep the public
            directory free for everyone.
          </p>
        </div>

        <PricingPlansGrid
          activeWorkspaceName={activeWorkspace?.name ?? null}
          billing={billing}
          freeCta={freeCta}
          pendingCheckoutKey={pendingCheckoutKey}
          proCheckoutInterval={proCheckoutInterval}
          teamCheckoutInterval={teamCheckoutInterval}
          onBillingChange={setBilling}
          onCheckout={handleCheckout}
        />

        <PricingResearchPassCard
          pendingCheckoutKey={pendingCheckoutKey}
          onPurchase={(interval) => {
            void handleCheckout({
              product: "atlas_research_pass",
              interval,
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
