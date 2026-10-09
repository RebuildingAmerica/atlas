import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { loadPaidAccess } from "@/domains/waitlist/waitlist.functions";
import { paidPlanAction } from "@/domains/waitlist/pricing-access";
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

const NO_ALLOWED_OFFERS: readonly string[] = [];

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
  const access = useQuery({
    queryKey: ["waitlist", "access", session.data?.user.id],
    queryFn: () => loadPaidAccess(),
    retry: false,
    staleTime: 30_000,
  });
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
  // Auto-resume and purchase controls wait for confirmed availability.
  const isCheckoutConfirmedOpen = availability.data?.available === true;
  const allowedOffers = availability.data?.allowedOffers ?? NO_ALLOWED_OFFERS;

  const activeProducts = session.data?.workspace.activeProducts ?? [];
  const actionFor = (
    product: PricingCheckoutParams["product"],
    interval: PricingCheckoutInterval,
  ) =>
    paidPlanAction(
      session.data === undefined ? undefined : access.data,
      product,
      isCheckoutConfirmedOpen && allowedOffers.includes(checkoutKey(product, interval)),
      activeProducts,
      interval,
    );

  async function handleCheckout({ product, interval }: PricingCheckoutParams) {
    const action = actionFor(product, interval);
    setPendingCheckoutKey(checkoutKey(product, interval));
    try {
      if (action.kind === "account") await navigate({ to: "/account" });
      else if (action.kind === "request" && action.requestId)
        await navigate({ to: "/waitlist/request/$id", params: { id: action.requestId } });
      else if (action.kind === "join")
        await navigate({ to: "/waitlist", search: { product, interval } });
      else await navigate({ to: "/onboarding", search: { product, interval } });
    } finally {
      setPendingCheckoutKey(null);
    }
  }

  useEffect(() => {
    if (!intent || !intentInterval || !access.data || session.data === undefined || session.isError)
      return;
    const action = paidPlanAction(
      access.data,
      intent,
      isCheckoutConfirmedOpen && allowedOffers.includes(checkoutKey(intent, intentInterval)),
      session.data?.workspace.activeProducts ?? [],
    );
    if (action.disabled) return;
    if (action.kind === "join")
      void navigate({ to: "/waitlist", search: { product: intent, interval: intentInterval } });
    else if (action.kind === "request" && action.requestId)
      void navigate({ to: "/waitlist/request/$id", params: { id: action.requestId } });
    else if (action.kind === "account") void navigate({ to: "/account" });
    else
      void navigate({ to: "/onboarding", search: { product: intent, interval: intentInterval } });
  }, [
    intent,
    intentInterval,
    access.data,
    isCheckoutConfirmedOpen,
    allowedOffers,
    navigate,
    session.data,
    session.isError,
  ]);

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
          <p className="type-label-medium text-ink-muted mb-3 tracking-wider uppercase">Plans</p>
          <h1 className="type-display-small text-ink-strong mb-4 leading-tight">
            Atlas is free to use. <br />
            Find the people behind the work.
          </h1>
          <p className="type-body-large text-ink-soft mb-6 leading-relaxed">
            Browse source-linked profiles without an account. Create a free account to save
            shortlists and run research. Paid plans add more research capacity and a shared team
            workspace.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              to={isAuthed ? "/discovery" : "/browse"}
              className="type-label-large bg-accent text-accent-ink hover:bg-accent-deep inline-flex items-center justify-center rounded-full px-6 py-3 no-underline transition-colors duration-150"
            >
              {isAuthed ? "Open your workspace" : "Browse profiles"} &rarr;
            </Link>
            {!isAuthed && (
              <Link to="/sign-up" className="type-label-medium text-accent-deep hover:underline">
                Create a free account &rarr;
              </Link>
            )}
          </div>
        </div>

        {isCheckoutUnavailable && access.data?.mode !== "waitlist" && (
          <div
            role="status"
            className="bg-error-container text-on-error-container mb-8 rounded-[1.4rem] px-4 py-6"
          >
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-5 w-5" aria-hidden />
              Paid plans are temporarily unavailable
            </div>
            <p className="type-body-medium mt-2">
              New purchases are unavailable right now. Browsing and free accounts remain open.
            </p>
          </div>
        )}

        {access.data?.mode === "waitlist" ? (
          <p className="type-body-medium text-ink-soft mb-6">
            Paid plans are available by invitation. Joining the waitlist costs nothing.
          </p>
        ) : null}
        {session.isError ? (
          <p role="status" className="type-body-medium text-ink-soft mb-6">
            Your account could not load.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                void session.refetch();
              }}
            >
              Retry account
            </button>
          </p>
        ) : null}
        {access.isError ? (
          <p role="status" className="type-body-medium text-ink-soft mb-6">
            Paid plan availability could not load.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                void access.refetch();
              }}
            >
              Try again
            </button>
          </p>
        ) : null}
        <p className="type-body-small text-ink-muted mb-6">
          Paid subscriptions help keep the public directory free.
        </p>

        <PricingPlansGrid
          activeWorkspaceName={activeWorkspace?.name ?? null}
          billing={billing}
          freeCta={freeCta}
          paidActions={{
            atlas_pro: actionFor("atlas_pro", proCheckoutInterval),
            atlas_team: actionFor("atlas_team", teamCheckoutInterval),
          }}
          pendingCheckoutKey={pendingCheckoutKey}
          isCheckoutUnavailable={isCheckoutUnavailable}
          allowedOffers={allowedOffers}
          proCheckoutInterval={proCheckoutInterval}
          teamCheckoutInterval={teamCheckoutInterval}
          onBillingChange={setBilling}
          onCheckout={handleCheckout}
        />

        <PricingResearchPassCard
          weeklyAction={actionFor("atlas_research_pass", "weekly")}
          monthlyAction={actionFor("atlas_research_pass", "once")}
          pendingCheckoutKey={pendingCheckoutKey}
          isCheckoutUnavailable={isCheckoutUnavailable}
          allowedOffers={allowedOffers}
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
