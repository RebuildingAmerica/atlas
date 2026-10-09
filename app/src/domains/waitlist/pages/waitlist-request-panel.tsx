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
import { WaitlistError, waitlistFieldClass } from "./waitlist-layout";

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
      <header className="space-y-3">
        <p className="type-label-medium text-ink-muted">{productLabel}</p>
        <h1 className="type-display-small text-ink-strong">
          {request.status === "unconfirmed"
            ? "Confirm your waitlist request"
            : closed
              ? request.status === "revoked"
                ? "This invitation is no longer available"
                : "You’ve left the waitlist"
              : request.purchasedAt
                ? "Your signup is complete"
                : invited
                  ? `You can now sign up for ${productLabel}`
                  : "You’re on the waitlist"}
        </h1>
        <p className="type-body-medium text-ink-soft break-all">{request.email}</p>
        {!closed && !invited && !needsConfirmation && !request.purchasedAt ? (
          <p className="type-body-large text-ink-soft">
            Your request for {productLabel} is confirmed. Your invitation will arrive by email.
          </p>
        ) : null}
      </header>
      {needsConfirmation ? (
        <section className="space-y-3">
          <p className="type-body-medium text-ink-soft">
            {closed
              ? "Confirm your email before rejoining this waitlist."
              : `Confirm your request to join the waitlist for ${productLabel}.`}
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
              className="type-label-large text-accent-deep underline"
            >
              Request a confirmation email
            </Link>
          )}
        </section>
      ) : null}
      {invited && !request.purchasedAt ? (
        <section className="space-y-4">
          <p className="type-body-medium text-ink-soft">
            Purchase permission has no expiry date. Payment is required for paid access.
          </p>
          {sameEmail ? (
            <>
              <label className="type-label-large block space-y-2">
                <span id="waitlist-interval-label">Billing interval</span>
                <select
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
                className="text-accent-deep type-label-large inline-block underline"
              >
                Continue to signup and payment
              </Link>
            </>
          ) : (
            <div className="space-y-3">
              {session.data ? (
                <p className="type-body-medium text-ink-soft">
                  Sign in with {request.email} to use this invitation.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-4">
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
                    className="type-label-large text-accent-deep underline"
                  >
                    Sign in
                  </Link>
                )}
                {!session.data ? (
                  <Link
                    to="/sign-up"
                    search={{ redirect }}
                    className="type-label-large text-accent-deep underline"
                  >
                    Create a free account
                  </Link>
                ) : null}
              </div>
            </div>
          )}
        </section>
      ) : null}
      {request.purchasedAt && !closed ? (
        <Link to="/account" className="type-label-large text-accent-deep inline-block underline">
          Open your account
        </Link>
      ) : null}
      <WaitlistError message={error} />
      <p role="status" className="type-body-small text-ink-soft">
        {message}
      </p>
      {!closed ? (
        <details className="border-border rounded-xl border p-4">
          <summary className="type-label-large cursor-pointer">Your details</summary>
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
                maxLength={200}
                value={organization}
                onChange={(event) => {
                  setOrganization(event.target.value);
                }}
                className={waitlistFieldClass}
              />
            </label>
            <label className="type-label-large block space-y-2">
              <span>Intended use</span>
              <textarea
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
      <div className="border-border space-y-4 border-t pt-4">
        <Link to="/waitlist" className="text-accent-deep type-label-medium inline-block underline">
          Request a different plan
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
              Leave this waitlist and give up unused purchase permission? Existing paid access
              continues.
            </p>
            <div className="flex gap-3">
              <Button
                disabled={pending}
                variant="secondary"
                onClick={() => {
                  void save("withdraw");
                }}
              >
                Leave waitlist
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setWithdrawConfirm(false);
                }}
              >
                Keep request
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="text-ink-muted type-label-medium block underline"
            onClick={() => {
              setWithdrawConfirm(true);
            }}
          >
            Withdraw request
          </button>
        )}
      </div>
      {closed ? (
        <a
          className="text-accent-deep type-label-medium inline-block underline"
          href="mailto:hello@rebuildingus.org"
        >
          Contact support
        </a>
      ) : null}
    </div>
  );
}
