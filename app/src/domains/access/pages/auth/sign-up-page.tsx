import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useEffect, useState } from "react";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { sanitizeAtlasRedirectPath } from "@rebuildingamerica/atlas-access/redirect-paths";
import { requestMagicLink } from "@/domains/access/session.functions";
import {
  AUTH_ERROR_CODE,
  buildAuthErrorLabels,
  extractAuthErrorCode,
} from "@rebuildingamerica/atlas-access/auth-errors";
import { buildSignInCallbackURL } from "./sign-in-page-helpers";
import { SignUpFormPanel } from "./components/sign-up-form-panel";
import { SignUpSentPanel } from "./components/sign-up-sent-panel";
import { loadCheckoutAvailability } from "@/domains/billing/purchase-onboarding.functions";

/**
 * Recognised intent the sign-up route accepts via the `intent` search param.
 *
 * `team-sso` is the only value today; it triggers the team-plan-buyer copy
 * and keeps the post-sign-up handoff inside the paid onboarding flow.
 */
export type SignUpIntent = "team-sso";

interface SignUpPageProps {
  intent?: SignUpIntent;
  redirectTo?: string;
}

/**
 * Magic-link expiry surfaced in the post-submit confirmation view.  Mirrors
 * the explicit `expiresIn: 300` pinned on the Better Auth `magicLink` plugin
 * in `app/src/domains/access/server/auth.ts` so the countdown the user reads
 * here matches the server's actual TTL.
 */
const MAGIC_LINK_EXPIRY_SECONDS = 300;
const RESEND_COOLDOWN_SECONDS = 30;
const CROSS_DEVICE_POLL_INTERVAL_MS = 3000;

const SIGN_UP_ERROR_LABELS = buildAuthErrorLabels("sign-up");

const TEAM_SSO_REDIRECT = (interval: "monthly" | "yearly") =>
  `/onboarding?product=atlas_team&interval=${interval}`;

function isPurchaseStartRedirect(redirect: string): boolean {
  return redirect === "/onboarding" || redirect.startsWith("/onboarding?");
}

function buildPostCredentialTarget(accountReady: boolean, redirectTo: string | undefined): string {
  const target = sanitizeAtlasRedirectPath(redirectTo) ?? "/account";
  if (accountReady || isPurchaseStartRedirect(target)) {
    return target;
  }
  return `/setup?redirect=${encodeURIComponent(target)}`;
}

/**
 * Sign-up page for new Atlas accounts.
 *
 * Collects an email address and sends a magic link, with the same response
 * whether or not the address is registered. After the link is sent the page
 * swaps into a confirmation view that:
 *
 *   - counts the magic-link TTL down to zero,
 *   - exposes a Resend button gated by a 30 s cool-down,
 *   - polls the Atlas session so a same-browser link click hands off
 *     automatically into the requested workspace, and
 *   - tells the operator that opening the link on a different device works
 *     and they can leave this tab alone.
 *
 * @param props - Component props.
 * @param props.intent - Optional sign-up intent that switches the heading
 *   copy and pre-fills the post-sign-in redirect to the team-plan checkout.
 * @param props.redirectTo - Explicit post-sign-in redirect path; takes
 *   precedence over the intent default.
 */
export function SignUpPage({ intent, redirectTo }: SignUpPageProps = {}) {
  const queryClient = useQueryClient();
  const session = useAtlasSession();

  const isTeamSso = intent === "team-sso";
  const checkoutAvailability = useQuery({
    queryKey: ["billing", "checkout-availability"],
    queryFn: () => loadCheckoutAvailability(),
    enabled: isTeamSso,
    staleTime: 30_000,
    retry: false,
  });
  const teamOffers = checkoutAvailability.data?.allowedOffers ?? [];
  const teamInterval = teamOffers.includes("atlas_team:monthly")
    ? "monthly"
    : teamOffers.includes("atlas_team:yearly")
      ? "yearly"
      : null;
  const isTeamAvailable =
    !checkoutAvailability.isError &&
    checkoutAvailability.data?.available === true &&
    teamInterval !== null;
  const effectiveRedirect =
    redirectTo ?? (isTeamSso && teamInterval ? TEAM_SSO_REDIRECT(teamInterval) : undefined);
  const callbackURL = buildSignInCallbackURL(undefined, effectiveRedirect);

  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"form" | "sent">("form");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [captureMailboxUrl, setCaptureMailboxUrl] = useState<string | null>(null);

  const [secondsUntilExpiry, setSecondsUntilExpiry] = useState(MAGIC_LINK_EXPIRY_SECONDS);
  const [secondsUntilResend, setSecondsUntilResend] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "sent") {
      return;
    }
    const expiryTimer = window.setInterval(() => {
      setSecondsUntilExpiry((current) => Math.max(0, current - 1));
    }, 1000);
    return () => {
      window.clearInterval(expiryTimer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "sent" || secondsUntilResend <= 0) {
      return;
    }
    const cooldownTimer = window.setInterval(() => {
      setSecondsUntilResend((current) => Math.max(0, current - 1));
    }, 1000);
    return () => {
      window.clearInterval(cooldownTimer);
    };
  }, [phase, secondsUntilResend]);

  // Cross-device handoff: while the operator is on the confirmation screen,
  // poll the session.  When the magic link is opened in this same browser
  // (most common case) the auth cookie lands here and the next poll picks
  // it up; we then forward to the requested redirect automatically without
  // making the user click anything else.  When the link is opened on a
  // separate device the local poll keeps returning null — the copy below
  // tells the user that's fine.
  useEffect(() => {
    if (phase !== "sent") {
      return;
    }
    const interval = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: [...atlasSessionQueryKey] });
    }, CROSS_DEVICE_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [phase, queryClient]);

  useEffect(() => {
    if (phase !== "sent" || !session.data) {
      return;
    }
    const target = buildPostCredentialTarget(session.data.accountReady, effectiveRedirect);
    window.location.assign(target);
  }, [phase, session.data, effectiveRedirect]);

  // The magic link signs in an existing operator and registers a new one, so
  // one path serves both and the response reveals neither.
  const sendMagicLinkRequest = async (): Promise<void> => {
    const result = await requestMagicLink({ data: { callbackURL, email } });
    setCaptureMailboxUrl(result.captureMailboxUrl ?? null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setIsPending(true);

    try {
      await sendMagicLinkRequest();
      setSecondsUntilExpiry(MAGIC_LINK_EXPIRY_SECONDS);
      setSecondsUntilResend(RESEND_COOLDOWN_SECONDS);
      setResendStatus(null);
      setPhase("sent");
    } catch (error) {
      const code = extractAuthErrorCode(error);
      setErrorMessage(code ? SIGN_UP_ERROR_LABELS[code] : "Sign-up is temporarily unavailable.");
    } finally {
      setIsPending(false);
    }
  };

  const handleResend = async () => {
    /* v8 ignore start -- defensive guard; the Resend button is disabled while either condition holds, so the early return is unreachable from the UI */
    if (secondsUntilResend > 0 || isResending) {
      return;
    }
    /* v8 ignore stop */
    setIsResending(true);
    setResendStatus(null);
    try {
      const result = await requestMagicLink({ data: { callbackURL, email } });
      setCaptureMailboxUrl(result.captureMailboxUrl ?? null);
      setSecondsUntilExpiry(MAGIC_LINK_EXPIRY_SECONDS);
      setSecondsUntilResend(RESEND_COOLDOWN_SECONDS);
      setResendStatus("Sent. Check your inbox.");
    } catch (error) {
      const code = extractAuthErrorCode(error);
      setResendStatus(
        code === AUTH_ERROR_CODE.EMAIL_DELIVERY_FAILED
          ? "Your sign-up link couldn't be delivered. Please try again."
          : "Could not resend the link. Please try again.",
      );
    } finally {
      setIsResending(false);
    }
  };

  if (phase === "sent") {
    return (
      <SignUpSentPanel
        captureMailboxUrl={captureMailboxUrl}
        email={email}
        isResending={isResending}
        isTeamSso={isTeamSso}
        resendStatus={resendStatus}
        secondsUntilExpiry={secondsUntilExpiry}
        secondsUntilResend={secondsUntilResend}
        onResend={() => {
          void handleResend();
        }}
        onUseDifferentEmail={() => {
          setPhase("form");
          setErrorMessage(null);
          setResendStatus(null);
        }}
      />
    );
  }

  if (isTeamSso && !isTeamAvailable) {
    if (checkoutAvailability.isPending && !checkoutAvailability.isError) {
      return (
        <div className="space-y-3" role="status">
          <p className="type-label-medium text-outline">Atlas Team</p>
          <h1 className="type-display-small text-on-surface">Checking Team plan availability</h1>
          <p className="type-body-large text-outline">
            One moment while we check the current plans.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="type-label-medium text-outline">Atlas Team</p>
          <h1 className="type-display-small text-on-surface">Atlas Team sign-up is unavailable</h1>
          <p className="type-body-large text-outline">
            New Team purchases are unavailable right now. You can still browse Atlas or create a
            free account, and check the plans again later.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link to="/sign-up" className="type-label-medium text-accent-deep hover:underline">
            Create a free account &rarr;
          </Link>
          <Link to="/pricing" className="type-label-medium text-accent-deep hover:underline">
            Compare plans &rarr;
          </Link>
          <Link to="/browse" className="type-label-medium text-accent-deep hover:underline">
            Browse Atlas &rarr;
          </Link>
        </div>
      </div>
    );
  }

  return (
    <SignUpFormPanel
      effectiveRedirect={effectiveRedirect}
      email={email}
      errorMessage={errorMessage}
      isPending={isPending}
      isTeamSso={isTeamSso}
      onEmailChange={setEmail}
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
    />
  );
}
