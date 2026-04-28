import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { checkAccountExists, requestMagicLink } from "@/domains/access/session.functions";
import {
  AUTH_ERROR_CODE,
  buildAuthErrorLabels,
  extractAuthErrorCode,
} from "@/domains/access/auth-errors";
import { DevMailCaptureBanner } from "./dev-mail-capture-banner";
import { buildSignInCallbackURL } from "./sign-in-page-helpers";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";

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

function formatExpiryCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

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
    const expiryLabel =
      secondsUntilExpiry > 0
        ? `Link expires in ${formatExpiryCountdown(secondsUntilExpiry)}`
        : "Link expired — request a new one below.";
    const resendLabel = isResending
      ? "Resending..."
      : secondsUntilResend > 0
        ? `Resend in ${secondsUntilResend}s`
        : "Resend link";

    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <p className="type-label-medium text-outline">
            {isTeamSso ? "Atlas Team" : "Create your account"}
          </p>
          <h1 className="type-display-small text-on-surface">Check your inbox</h1>
          <p className="type-body-large text-outline">
            We sent a sign-up link to <span className="text-on-surface font-medium">{email}</span>.
          </p>
        </div>

        <div className="border-outline-variant rounded-2xl border px-4 py-3">
          <p className="type-body-medium text-on-surface" aria-live="polite">
            {expiryLabel}
          </p>
        </div>

        {captureMailboxUrl ? <DevMailCaptureBanner url={captureMailboxUrl} /> : null}

        <div className="space-y-2">
          <Button
            variant="secondary"
            disabled={secondsUntilResend > 0 || isResending}
            onClick={() => {
              void handleResend();
            }}
          >
            {resendLabel}
          </Button>
          {resendStatus ? (
            <p className="type-body-small text-outline" aria-live="polite">
              {resendStatus}
            </p>
          ) : null}
        </div>

        <p className="type-body-medium text-outline">
          Opening the link on a different device is fine — once you sign in there, you can close
          this tab. If you click the link on this device, this page will continue automatically.
        </p>

        <button
          type="button"
          className="type-label-medium text-accent hover:underline"
          onClick={() => {
            setPhase("form");
            setErrorMessage(null);
            setResendStatus(null);
          }}
        >
          Use a different email
        </button>
      </div>
    );
  }

  const eyebrow = isTeamSso ? "Atlas Team" : "Create your account";
  const heading = isTeamSso ? "Set up SSO for your team" : "Join Atlas";
  const subhead = isTeamSso
    ? "Create your account, then choose Atlas Team and configure your identity provider. Free to start; pay only when you confirm the team plan."
    : "Enter your email and we'll send you a link to get started. Free to join.";
  const ctaCopy = isPending
    ? "Creating account..."
    : isTeamSso
      ? "Continue with team setup"
      : "Create account";

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="type-label-medium text-outline">{eyebrow}</p>
        <h1 className="type-display-small text-on-surface">{heading}</h1>
        <p className="type-body-large text-outline">{subhead}</p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          autoComplete="email"
          required
          icon={<Mail className="h-4 w-4" />}
        />

        <Button type="submit" disabled={isPending || !email.trim()}>
          {ctaCopy}
        </Button>
      </form>

      {errorMessage ? (
        <p className="type-body-medium rounded-2xl bg-red-50 px-4 py-3 text-red-700">
          {errorMessage}
        </p>
      ) : null}

      <p className="type-body-medium text-outline">
        Already have an account?{" "}
        <Link
          to="/sign-in"
          search={effectiveRedirect ? { redirect: effectiveRedirect } : undefined}
          className="text-accent type-label-medium hover:underline"
        >
          Sign in &rarr;
        </Link>
      </p>

      {!isTeamSso ? (
        <div className="border-outline-variant rounded-2xl border px-4 py-3">
          <p className="type-body-small text-outline">
            Setting up SSO for your team?{" "}
            <Link
              to="/sign-up"
              search={{ intent: "team-sso" }}
              className="text-accent type-label-small hover:underline"
            >
              Start the team plan &rarr;
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}
