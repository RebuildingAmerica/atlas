import { Check } from "lucide-react";
import { signOutWithRedirect } from "@/domains/access/client/sign-out";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import {
  defaultOnboardingInterval,
  isValidOnboardingSelection,
} from "@rebuildingamerica/atlas-access/onboarding/setup-state";
import type { WaitlistLinkKind, WaitlistRequest } from "../contracts";
import { updateWaitlistRequest, changeWaitlistRequest } from "../waitlist.functions";
import {
  WaitlistError,
  waitlistFieldClass,
  waitlistPrimaryLinkClass,
  waitlistTextLinkClass,
  waitlistSummaryClass,
} from "./waitlist-layout";

export function WaitlistRequestPanel({
  initialRequest,
  token,
  kind,
}: {
  initialRequest: WaitlistRequest;
  token?: string;
  kind?: WaitlistLinkKind;
}) {
  const [request, setRequest] = useState(initialRequest);
  const [name, setName] = useState(request.name);
  const [organization, setOrganization] = useState(request.organization);
  const [intendedUse, setIntendedUse] = useState(request.intendedUse);
  const [pending, setPending] = useState(false);
  const [withdrawConfirm, setWithdrawConfirm] = useState(false);
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
      setRequest(result);
      setWithdrawConfirm(false);
      setMessage(action === "update" ? "Details saved." : null);
      await queryClient.invalidateQueries({ queryKey: ["waitlist", "access"] });
    } catch (error) {
      setError(userFacingErrorMessage(error, "Your request could not be updated. Try again."));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <header className="space-y-3" aria-live="polite">
        {!closed && !needsConfirmation ? (
          <div className="bg-surface-container text-accent-deep mb-5 flex h-12 w-12 items-center justify-center rounded-2xl">
            <Check className="h-6 w-6" aria-hidden="true" />
          </div>
        ) : null}
        {!invited || request.purchasedAt ? (
          <p className="type-label-medium text-ink-muted">{productLabel}</p>
        ) : null}
        <h1 className="type-display-small text-ink-strong text-balance">
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
        <p className="type-body-small text-ink-muted break-all">{request.email}</p>
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
        <section className="space-y-4">
          <p className="type-body-medium text-ink-soft">
            {sameEmail
              ? "Choose a payment option. You’ll review the total at checkout."
              : "Sign in or create an account to get started."}
          </p>
          {sameEmail ? (
            <>
              <label className="type-label-large block space-y-2">
                <span id="waitlist-interval-label">Payment option</span>
                <select
                  name="interval"
                  aria-labelledby="waitlist-interval-label"
                  value={interval}
                  onChange={(event) => {
                    setInterval(event.target.value);
                  }}
                  className={waitlistFieldClass}
                >
                  {request.product === "atlas_research_pass" ? (
                    <>
                      <option value="weekly">7 days · $4, one payment</option>
                      <option value="once">30 days · $9, one payment</option>
                    </>
                  ) : (
                    <>
                      <option value="monthly">
                        Monthly ·{" "}
                        {request.product === "atlas_pro"
                          ? "$5/month"
                          : "$25/month + $8/additional seat"}
                      </option>
                      <option value="yearly">
                        Annual ·{" "}
                        {request.product === "atlas_pro"
                          ? "$48/year"
                          : "$250/year + $80/additional seat"}
                      </option>
                      {request.product === "atlas_pro" ? (
                        <option value="four_month">
                          Student · $12.80/4 months, verification required
                        </option>
                      ) : null}
                    </>
                  )}
                </select>
              </label>
              <Link
                to="/onboarding"
                search={{
                  product: request.product,
                  interval: interval as "monthly" | "yearly" | "four_month" | "weekly" | "once",
                }}
                className={`${waitlistPrimaryLinkClass} w-full`}
              >
                Continue to checkout
              </Link>
            </>
          ) : (
            <div className="space-y-3">
              {!session.data ? (
                <p className="type-body-medium text-ink-soft">
                  Use <strong className="break-all">{request.email}</strong> when you create your
                  account.
                </p>
              ) : null}
              {session.data ? (
                <p className="type-body-medium text-ink-soft">
                  This invitation is for <strong className="break-all">{request.email}</strong>.
                  Switch to that account to continue.
                </p>
              ) : null}
              <div className="flex flex-col gap-3">
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
      <WaitlistError message={error} />
      {message ? (
        <p role="status" className="type-body-small text-ink-soft">
          {message}
        </p>
      ) : null}
      {!closed ? (
        <details className="border-border rounded-xl border p-4">
          <summary className={waitlistSummaryClass}>Your details</summary>
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save("update");
            }}
          >
            <label className="type-label-large block space-y-2">
              <span>Name</span>
              <input
                name="name"
                autoComplete="name"
                maxLength={120}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                className={waitlistFieldClass}
              />
            </label>
            <label className="type-label-large block space-y-2">
              <span>Organization</span>
              <input
                name="organization"
                autoComplete="organization"
                maxLength={200}
                value={organization}
                onChange={(event) => {
                  setOrganization(event.target.value);
                }}
                className={waitlistFieldClass}
              />
            </label>
            <label className="type-label-large block space-y-2">
              <span>What would you use Atlas for?</span>
              <textarea
                name="intendedUse"
                autoComplete="off"
                rows={3}
                maxLength={2000}
                value={intendedUse}
                onChange={(event) => {
                  setIntendedUse(event.target.value);
                }}
                className={waitlistFieldClass}
              />
            </label>
            <Button disabled={pending} type="submit" variant="secondary">
              Save details
            </Button>
          </form>
        </details>
      ) : null}
      <div className="border-border flex flex-col items-start gap-3 border-t pt-4">
        <Link to="/waitlist" className={waitlistTextLinkClass}>
          Join another plan’s waitlist
        </Link>
        {closed && needsConfirmation ? null : closed ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => {
              void save("rejoin");
            }}
          >
            Rejoin waitlist
          </Button>
        ) : withdrawConfirm ? (
          <div className="space-y-3">
            <p className="type-body-medium">
              Leave the {productLabel} waitlist? You’ll need a new invitation to sign up later. Any
              plan you already pay for will stay active.
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
        ) : (
          <button
            type="button"
            className={`${waitlistTextLinkClass} text-ink-muted block`}
            onClick={() => {
              setWithdrawConfirm(true);
            }}
          >
            Leave waitlist
          </button>
        )}
      </div>
      {closed ? (
        <a className={waitlistTextLinkClass} href="mailto:hello@rebuildingus.org">
          Contact support
        </a>
      ) : null}
    </div>
  );
}
