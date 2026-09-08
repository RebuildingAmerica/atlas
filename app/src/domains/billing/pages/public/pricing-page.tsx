import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { loadCheckoutAvailability } from "@/domains/billing/purchase-onboarding.functions";
import { PageLayout } from "@rebuildingamerica/atlas-ui/layout/page-layout";
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
 * a Research Pass option. CTA buttons route into /onboarding, which collects
 * an account, a passkey, and a workspace before handing off to Stripe.
 *
 * The CTAs go inert when checkout is unavailable, either because an operator
 * paused the funnel or because the catalog cannot serve directory results.
 * The server functions refuse independently, so this is presentation only.
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
  const availability = useQuery({
    queryKey: ["billing", "checkout-availability"],
    queryFn: () => loadCheckoutAvailability(),
    staleTime: 30_000,
    retry: false,
  });
  // A failed query is treated as unavailable. The alternative leaves the CTAs
  // live and the banner hidden on exactly the deployment where the server
  // functions are going to refuse anyway.
  const isCheckoutUnavailable = availability.data?.available === false || availability.isError;
  // Auto-resume runs with no user in the loop, so it waits for a confirmed
  // yes. A deliberate click may proceed while the probe is still in flight
  // because the server function refuses with a readable message anyway.
  const isCheckoutConfirmedOpen = availability.data?.available === true;

  // No unavailability guard here: every CTA container takes a required
  // isCheckoutUnavailable prop and disables its buttons, and the server
  // functions refuse on their own. A guard in this handler would be
  // unreachable and would only look like protection.
  async function handleCheckout({ product, interval }: PricingCheckoutParams) {
    setPendingCheckoutKey(checkoutKey(product, interval));
    try {
      await navigate({ to: "/onboarding", search: { product, interval } });
    } finally {
      setPendingCheckoutKey(null);
    }
  }

  useEffect(() => {
    if (!intent || !intentInterval || !isCheckoutConfirmedOpen) {
      return;
    }
    void navigate({ to: "/onboarding", search: { product: intent, interval: intentInterval } });
  }, [intent, intentInterval, isCheckoutConfirmedOpen, navigate]);

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

        {isCheckoutUnavailable && (
          <div
            role="status"
            className="bg-error-container text-on-error-container mb-8 rounded-[1.4rem] px-4 py-6"
          >
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-5 w-5" aria-hidden />
              Paid plans are temporarily unavailable
            </div>
            <p className="type-body-medium mt-2">
              We have paused checkout while we finish work on the public directory. Browsing and
              search stay free, and nothing on this page will charge you today.
            </p>
          </div>
        )}

        <PricingPlansGrid
          activeWorkspaceName={activeWorkspace?.name ?? null}
          billing={billing}
          freeCta={freeCta}
          pendingCheckoutKey={pendingCheckoutKey}
          isCheckoutUnavailable={isCheckoutUnavailable}
          proCheckoutInterval={proCheckoutInterval}
          teamCheckoutInterval={teamCheckoutInterval}
          onBillingChange={setBilling}
          onCheckout={handleCheckout}
        />

        <PricingResearchPassCard
          pendingCheckoutKey={pendingCheckoutKey}
          isCheckoutUnavailable={isCheckoutUnavailable}
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
