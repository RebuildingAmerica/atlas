import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { checkAccountExists, requestMagicLink } from "@/domains/access/session.functions";
import {
  AUTH_ERROR_CODE,
  buildAuthErrorLabels,
  extractAuthErrorCode,
} from "@/domains/access/auth-errors";
import { buildSignInCallbackURL } from "./sign-in-page-helpers";
import { SignUpFormPanel } from "./components/sign-up-form-panel";
import { SignUpSentPanel } from "./components/sign-up-sent-panel";

/**
 * Recognised intent the sign-up route accepts via the `intent` search param.
 *
 * `team-sso` is the only value today; it triggers the team-plan-buyer copy
 * and forces the post-sign-up redirect to bounce through `/pricing` so
 * checkout starts as soon as the magic-link callback resolves.
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

const TEAM_SSO_REDIRECT = "/pricing?intent=atlas_team&interval=monthly";

/**
 * Sign-up page for new Atlas accounts.
 *
 * Collects an email address and sends a magic link.  When the email already
 * has an account, redirects to /sign-in with a notice.  After the link is
 * sent the page swaps into a confirmation view that:
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useAtlasSession();

  const isTeamSso = intent === "team-sso";
  const effectiveRedirect = redirectTo ?? (isTeamSso ? TEAM_SSO_REDIRECT : undefined);
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
    const target = effectiveRedirect ?? "/account";
    window.location.assign(target);
  }, [phase, session.data, effectiveRedirect]);

  const sendMagicLinkRequest = async (): Promise<boolean> => {
    const accountCheck = await checkAccountExists({ data: { email } });
    if (accountCheck.exists) {
      await navigate({
        to: "/sign-in",
        search: effectiveRedirect
          ? { email, existing: true, redirect: effectiveRedirect }
          : { email, existing: true },
      });
      return false;
    }
    const result = await requestMagicLink({ data: { callbackURL, email } });
    setCaptureMailboxUrl(result.captureMailboxUrl ?? null);
    return true;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setIsPending(true);

    try {
      const sent = await sendMagicLinkRequest();
      if (sent) {
        setSecondsUntilExpiry(MAGIC_LINK_EXPIRY_SECONDS);
        setSecondsUntilResend(RESEND_COOLDOWN_SECONDS);
        setResendStatus(null);
        setPhase("sent");
      }
    } catch (error) {
      const code = extractAuthErrorCode(error);
      setErrorMessage(code ? SIGN_UP_ERROR_LABELS[code] : "Sign-up is temporarily unavailable.");
    } finally {
      setIsPending(false);
    }
  };

  const handleResend = async () => {
    if (secondsUntilResend > 0 || isResending) {
      return;
    }
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
