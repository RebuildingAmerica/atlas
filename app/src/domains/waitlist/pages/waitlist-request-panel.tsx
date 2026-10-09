import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import type { PricingCheckoutInterval } from "@/domains/billing/checkout-intervals";
import { PaymentChoice, PaymentTerms } from "@/domains/billing/components/payment-choice";
import { Textarea } from "@rebuildingamerica/atlas-ui/ui/textarea";
import { signOutWithRedirect } from "@/domains/access/client/sign-out";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import {
  buildOnboardingStartRedirect,
  defaultOnboardingInterval,
  isValidOnboardingSelection,
} from "@rebuildingamerica/atlas-access/onboarding/setup-state";
import type { WaitlistLinkKind, WaitlistProduct, WaitlistRequest } from "../contracts";
import { updateWaitlistRequest, changeWaitlistRequest } from "../waitlist.functions";
import {
  WaitlistError,
  waitlistSecondaryActionClass,
  waitlistSummaryClass,
  waitlistHeadingClass,
  waitlistPrimaryLinkClass,
  waitlistTextLinkClass,
} from "./waitlist-layout";

const INVITATION_DESCRIPTIONS: Record<WaitlistProduct, string> = {
  atlas_pro: "Unlimited research, notes and shortlists, and profile exports.",
  atlas_team: "Shared research, notes and shortlists, with watchlists for your team.",
  atlas_research_pass:
    "Research, notes and exports for a short project. One payment, no subscription.",
};

const INVITATION_BENEFITS: Record<WaitlistProduct, string[]> = {
  atlas_pro: [
    "Unlimited research requests on people and organizations",
    "Organize your findings with notes and shortlists",
    "Export profiles as CSV or JSON for your other tools",
  ],
  atlas_team: [
    "Unlimited research requests and exports",
    "Shared notes and shortlists",
    "Watchlists and monitoring for up to 50 members",
  ],
  atlas_research_pass: [
    "Research tools for one person",
    "Notes, shortlists, and exports",
    "Your notes and shortlists stay readable after the pass ends",
  ],
};

const INVITATION_INTEGRATIONS: Record<Exclude<WaitlistProduct, "atlas_research_pass">, string> = {
  atlas_pro: "API access with 1,000 requests per day, plus MCP and OAuth connections.",
  atlas_team: "API, MCP and OAuth access, with SSO and SCIM for your team.",
};

function InvitationBenefits({ product }: { product: WaitlistProduct }) {
  return (
    <ul className="type-body-medium text-ink-soft space-y-4">
      {INVITATION_BENEFITS[product].map((benefit) => (
        <li key={benefit} className="flex items-start gap-3">
          <span aria-hidden="true" className="text-civic">
            ✓
          </span>
          <span>{benefit}</span>
        </li>
      ))}
    </ul>
  );
}

export function WaitlistRequestPanel({
  initialRequest,
  token,
  kind,
  focusOnMount = false,
}: {
  initialRequest: WaitlistRequest;
  token?: string;
  kind?: WaitlistLinkKind;
  focusOnMount?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const focusNextState = useRef(false);
  const [request, setRequest] = useState(initialRequest);
  useEffect(() => {
    if (focusOnMount) heading.current?.focus();
  }, [focusOnMount]);
  useEffect(() => {
    if (focusNextState.current) {
      heading.current?.focus();
      focusNextState.current = false;
    }
  }, [request]);
  const [name, setName] = useState(request.name);
  const [organization, setOrganization] = useState(request.organization);
  const [intendedUse, setIntendedUse] = useState(request.intendedUse);
  const [pending, setPending] = useState(false);
  const [withdrawConfirm, setWithdrawConfirm] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useAtlasSession();
  const queryClient = useQueryClient();
  const needsConfirmation = !request.confirmedAt;
  const invited = request.status === "invited";
  const closed = request.status === "withdrawn" || request.status === "revoked";
  const productLabel = PRODUCT_LABELS[request.product];
  const sameEmail =
    session.data?.user.emailVerified && session.data.user.email.toLowerCase() === request.email;
  const defaultInterval = defaultOnboardingInterval(request.product);
  const [interval, setInterval] = useState<PricingCheckoutInterval>(() =>
    request.interval &&
    isValidOnboardingSelection(
      request.product,
      request.interval as "monthly" | "yearly" | "four_month" | "weekly" | "once",
    )
      ? (request.interval as PricingCheckoutInterval)
      : defaultInterval,
  );
  const redirect = buildOnboardingStartRedirect(request.product, interval);
  async function save(action: "update" | "withdraw" | "rejoin" | "confirm") {
    setPending(true);
    setError(null);
    setMessage(null);
    const data = { id: request.id, token, kind };
    try {
      const result =
        action === "update"
          ? await updateWaitlistRequest({
              data: { ...data, details: { name, organization, intendedUse } },
            })
          : await changeWaitlistRequest({ data: { ...data, action } });
      focusNextState.current = action !== "update";
      setRequest(result);
      setWithdrawConfirm(false);
      if (action === "update") {
        setMessage("Details saved.");
      } else {
        setManageOpen(false);
      }
      await queryClient.invalidateQueries({ queryKey: ["waitlist", "access"] });
    } catch (error) {
      setError(userFacingErrorMessage(error, "Your request could not be updated. Try again."));
    } finally {
      setPending(false);
    }
  }
  return (
    <div
      className={
        invited && !request.purchasedAt
          ? "flex flex-1 flex-col gap-8 lg:grid lg:grid-cols-2 lg:gap-16"
          : "space-y-8"
      }
    >
      <header className="space-y-6">
        {!invited || request.purchasedAt ? (
          <p className="type-label-medium text-ink-muted">{productLabel}</p>
        ) : null}
        <h1 ref={heading} tabIndex={-1} className={waitlistHeadingClass}>
          {request.status === "unconfirmed"
            ? "Confirm your email"
            : closed
              ? request.status === "revoked"
                ? "This invitation has been withdrawn"
                : "You’ve left the waitlist"
              : request.purchasedAt
                ? "You’re all set"
                : invited
                  ? `You’re invited to ${productLabel}`
                  : "You’re on the waitlist"}
        </h1>
        {invited && !request.purchasedAt ? (
          <div className="flex flex-col gap-6 lg:gap-8">
            <p className="type-body-large text-ink-soft">
              {INVITATION_DESCRIPTIONS[request.product]}
            </p>
            <details className="group lg:hidden">
              <summary className={waitlistSummaryClass}>What’s included</summary>
              <div className="space-y-4 pt-4">
                <InvitationBenefits product={request.product} />
                {request.product !== "atlas_research_pass" ? (
                  <p className="type-body-small text-ink-soft">
                    {INVITATION_INTEGRATIONS[request.product]}
                  </p>
                ) : null}
              </div>
            </details>
            <section aria-label="Included with your plan" className="hidden space-y-4 lg:block">
              <h2 className="type-title-medium text-ink-strong">What’s included</h2>
              <InvitationBenefits product={request.product} />
            </section>
            {request.product !== "atlas_research_pass" ? (
              <details className="group hidden lg:block">
                <summary className={waitlistSummaryClass}>API and integrations</summary>
                <p className="type-body-small text-ink-soft pt-3">
                  {INVITATION_INTEGRATIONS[request.product]}
                </p>
              </details>
            ) : null}
          </div>
        ) : null}
        {!closed && !invited && !needsConfirmation && !request.purchasedAt ? (
          <p className="type-body-large text-ink-soft">
            We’ll email you when you can sign up for {productLabel}. You can keep using Atlas for
            free.
          </p>
        ) : null}
      </header>
      {closed ? (
        <p className="type-body-large text-ink-soft">
          You can rejoin the waitlist. Any paid plan you already have will stay active.
        </p>
      ) : null}
      {needsConfirmation ? (
        <section className="space-y-3">
          <p className="type-body-medium text-ink-soft">
            {closed
              ? "Confirm your email before rejoining this waitlist."
              : `Confirm your email to join the waitlist for ${productLabel}.`}
          </p>
          {sameEmail ? (
            <Button
              disabled={pending}
              onClick={() => {
                void save("confirm");
              }}
            >
              Confirm request
            </Button>
          ) : (
            <Link
              to="/waitlist"
              search={{ product: request.product }}
              className={waitlistTextLinkClass}
            >
              Request a confirmation email
            </Link>
          )}
        </section>
      ) : null}
      {invited && !request.purchasedAt ? (
        <section className="lg:border-outline-variant flex flex-1 flex-col gap-6 lg:gap-8 lg:border-l lg:pl-16">
          <WaitlistError message={error} />
          <PaymentChoice product={request.product} interval={interval} onChange={setInterval} />
          <section aria-label="Next step" className="mt-auto space-y-4">
            <PaymentTerms product={request.product} interval={interval} />
            {sameEmail ? (
              <>
                <Link
                  to="/onboarding"
                  search={{
                    product: request.product,
                    interval,
                  }}
                  className={`${waitlistPrimaryLinkClass} w-full`}
                >
                  Choose workspace
                </Link>
              </>
            ) : (
              <div className="space-y-6">
                <p className="type-body-small text-ink-soft">
                  {session.data
                    ? "Sign in with the email that received your invitation."
                    : "Create an account or sign in with the email that received your invitation."}
                </p>
                <div className="flex flex-col gap-4">
                  {session.data ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        void signOutWithRedirect({
                          redirectTo: `/sign-in?email=${encodeURIComponent(request.email)}&redirect=${encodeURIComponent(redirect)}`,
                          onError: () => {
                            setError("Sign out failed. Try again.");
                          },
                        });
                      }}
                    >
                      Switch account
                    </Button>
                  ) : (
                    <>
                      <Link
                        to="/sign-in"
                        search={{ redirect, email: request.email }}
                        className={waitlistTextLinkClass}
                      >
                        Sign in
                      </Link>
                      <Link
                        to="/sign-up"
                        search={{ redirect }}
                        className={`${waitlistPrimaryLinkClass} w-full`}
                      >
                        Create account
                      </Link>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        </section>
      ) : null}
      {request.purchasedAt && !closed ? (
        <Link to="/account" className={waitlistPrimaryLinkClass}>
          Open your account
        </Link>
      ) : null}
      {!invited || request.purchasedAt ? <WaitlistError message={error} /> : null}
      {message ? (
        <p role="status" className="type-body-small text-ink-soft">
          {message}
        </p>
      ) : null}

      {closed && !needsConfirmation ? (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            void save("rejoin");
          }}
        >
          Rejoin waitlist
        </Button>
      ) : null}
      {!closed && !invited && !request.purchasedAt ? (
        <div>
          <button
            type="button"
            className={waitlistSecondaryActionClass}
            aria-expanded={manageOpen}
            aria-controls="waitlist-management"
            onClick={() => {
              setManageOpen((open) => !open);
            }}
          >
            Edit details
          </button>
        </div>
      ) : null}
      {!closed && !invited && !request.purchasedAt && manageOpen ? (
        <section id="waitlist-management" aria-label="Edit details" className="space-y-5">
          <h2 className="type-title-medium text-ink-strong">Your details</h2>
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save("update");
            }}
          >
            <Input
              label="Name"
              name="name"
              autoComplete="name"
              maxLength={120}
              value={name}
              onChange={setName}
              density="comfortable"
            />
            <Input
              label="Organization"
              name="organization"
              autoComplete="organization"
              maxLength={200}
              value={organization}
              onChange={setOrganization}
              density="comfortable"
            />
            <Textarea
              label="What would you use Atlas for?"
              name="intendedUse"
              autoComplete="off"
              rows={3}
              maxLength={2000}
              value={intendedUse}
              onChange={setIntendedUse}
              density="comfortable"
            />
            <Button disabled={pending} type="submit" variant="secondary">
              Save details
            </Button>
          </form>
          <div className="border-border flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-4">
            {!withdrawConfirm ? (
              <button
                type="button"
                className={waitlistTextLinkClass}
                onClick={() => {
                  setWithdrawConfirm(true);
                }}
              >
                Leave waitlist
              </button>
            ) : null}
          </div>
          {withdrawConfirm ? (
            <div className="space-y-3">
              <p className="type-body-medium text-ink-soft">
                Leave this waitlist? You can rejoin at any time. Any plan you already pay for will
                stay active.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  disabled={pending}
                  variant="secondary"
                  onClick={() => {
                    void save("withdraw");
                  }}
                >
                  Yes, leave waitlist
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setWithdrawConfirm(false);
                  }}
                >
                  Stay on waitlist
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
