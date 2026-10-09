import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import { Select } from "@rebuildingamerica/atlas-ui/ui/select";
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
  defaultOnboardingInterval,
  isValidOnboardingSelection,
} from "@rebuildingamerica/atlas-access/onboarding/setup-state";
import type { WaitlistLinkKind, WaitlistProduct, WaitlistRequest } from "../contracts";
import { updateWaitlistRequest, changeWaitlistRequest } from "../waitlist.functions";
import {
  WaitlistError,
  waitlistSecondaryActionClass,
  waitlistHeadingClass,
  waitlistPrimaryLinkClass,
  waitlistTextLinkClass,
} from "./waitlist-layout";

const INVITATION_DESCRIPTIONS: Record<WaitlistProduct, string> = {
  atlas_pro:
    "Atlas Pro includes unlimited research requests, notes and shortlists, and CSV/JSON exports.",
  atlas_team:
    "Atlas Team includes a shared research workspace, notes and shortlists, watchlists, and monitoring.",
  atlas_research_pass: "Get 7 or 30 days of research tools without a recurring subscription.",
};

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
  const redirect = `/waitlist/request/${request.id}`;
  const defaultInterval = defaultOnboardingInterval(request.product);
  const [interval, setInterval] = useState(() =>
    request.interval &&
    isValidOnboardingSelection(
      request.product,
      request.interval as "monthly" | "yearly" | "four_month" | "weekly" | "once",
    )
      ? request.interval
      : defaultInterval,
  );
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
          ? "flex flex-1 flex-col gap-12 lg:grid lg:grid-cols-2 lg:gap-16"
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
          <p className="type-body-large text-ink-soft">
            {INVITATION_DESCRIPTIONS[request.product]}
          </p>
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
        <section className="lg:border-outline-variant flex flex-1 flex-col gap-8 lg:border-l lg:pl-16">
          <WaitlistError message={error} />
          {sameEmail ? (
            <>
              <Select
                label="Payment option"
                name="interval"
                density="comfortable"
                value={interval}
                onChange={setInterval}
                options={
                  request.product === "atlas_research_pass"
                    ? [
                        { value: "weekly", label: "7 days · $4, one payment" },
                        { value: "once", label: "30 days · $9, one payment" },
                      ]
                    : [
                        {
                          value: "monthly",
                          label: `Monthly · ${request.product === "atlas_pro" ? "$5/month" : "$25/month + $8/additional seat"}`,
                        },
                        {
                          value: "yearly",
                          label: `Annual · ${request.product === "atlas_pro" ? "$48/year" : "$250/year + $80/additional seat"}`,
                        },
                        ...(request.product === "atlas_pro"
                          ? [
                              {
                                value: "four_month",
                                label: "Student · $12.80/4 months, verification required",
                              },
                            ]
                          : []),
                      ]
                }
              />
              <Link
                to="/onboarding"
                search={{
                  product: request.product,
                  interval: interval as "monthly" | "yearly" | "four_month" | "weekly" | "once",
                }}
                className={`${waitlistPrimaryLinkClass} mt-auto w-full`}
              >
                Continue
              </Link>
            </>
          ) : (
            <div className="flex flex-1 flex-col gap-8">
              {!session.data ? (
                <p className="type-body-medium text-ink-soft">
                  Use the email address that received your invitation.
                </p>
              ) : null}
              {session.data ? (
                <p className="type-body-medium text-ink-soft">
                  Switch to the account on your invitation to continue.
                </p>
              ) : null}
              <div className="mt-auto flex flex-col gap-4">
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
                  <Link
                    to="/sign-in"
                    search={{ redirect, email: request.email }}
                    className={waitlistTextLinkClass}
                  >
                    Sign in
                  </Link>
                )}
                {!session.data ? (
                  <Link to="/sign-up" search={{ redirect }} className={waitlistPrimaryLinkClass}>
                    Create a free account
                  </Link>
                ) : null}
              </div>
            </div>
          )}
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
