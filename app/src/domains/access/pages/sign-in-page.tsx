import { Mail, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";
import { getAuthConfig } from "../config";
import { getAuthClient } from "../client/auth-client";
import { waitForAtlasAuthenticatedSession } from "../client/session-confirmation";
import { requestMagicLink } from "../session.functions";

/**
 * Search params accepted by the sign-in route.
 */
export const signInSearchSchema = z.object({
  redirect: z.string().optional(),
});

/**
 * Sign-in experience for Atlas operator access.
 *
 * Magic-link email is the easiest onboarding path; passkey sign-in becomes
 * available after the operator has registered a passkey on their account.
 */
export function SignInPage({ redirectTo }: { redirectTo?: string }) {
  const authConfig = getAuthConfig();
  const lastMethod = getAuthClient().getLastUsedLoginMethod();
  const [email, setEmail] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasskeyPending, setIsPasskeyPending] = useState(false);

  const callbackURL = redirectTo || "/account";

  useEffect(() => {
    if (
      typeof PublicKeyCredential === "undefined" ||
      typeof PublicKeyCredential.isConditionalMediationAvailable !== "function"
    ) {
      return;
    }

    let active = true;

    void PublicKeyCredential.isConditionalMediationAvailable().then((available) => {
      if (!available || !active) return;
      void getAuthClient().signIn.passkey({
        autoFill: true,
        fetchOptions: {
          onSuccess: async () => {
            if (!active) return;
            await waitForAtlasAuthenticatedSession();
            window.location.assign(callbackURL);
          },
        },
      });
    });

    return () => {
      active = false;
    };
  }, [callbackURL]);

  const handleMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSubmitting(true);

    try {
      await requestMagicLink({
        data: {
          callbackURL,
          email,
        },
      });
      setStatusMessage("If the email can access Atlas, a sign-in link is on the way.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Sign-in is temporarily unavailable.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasskey = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsPasskeyPending(true);

    try {
      const result = await getAuthClient().signIn.passkey();
      if (result.error) {
        throw new Error(result.error.message || "Could not sign in with a passkey.");
      }
      await waitForAtlasAuthenticatedSession();
      window.location.assign(callbackURL);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not sign in with a passkey.");
    } finally {
      setIsPasskeyPending(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="type-label-medium text-[var(--ink-muted)]">Operator access</p>
        <h1 className="type-display-small text-[var(--ink-strong)]">Sign in to Atlas</h1>
      </div>

      <div className="space-y-5">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            void handleMagicLink(event);
          }}
        >
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@rebuildingus.org"
            autoComplete="username webauthn"
            required
            icon={<Mail className="h-4 w-4" />}
          />

          <div className="relative inline-block">
            <Button type="submit" disabled={isSubmitting || authConfig.localMode || !email}>
              {isSubmitting ? "Sending..." : "Send magic link"}
            </Button>
            {lastMethod === "magic-link" ? (
              <span className="type-label-small absolute -top-2 -right-2 rounded-full bg-[var(--ink-strong)] px-1.5 py-0.5 text-[var(--surface)]">
                Last used
              </span>
            ) : null}
          </div>
        </form>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--border)]" />
          <span className="type-label-small text-[var(--ink-muted)]">or</span>
          <div className="h-px flex-1 bg-[var(--border)]" />
        </div>

        <div className="relative inline-block">
          <Button
            variant="secondary"
            onClick={() => {
              void handlePasskey();
            }}
            disabled={isPasskeyPending || authConfig.localMode}
          >
            <span className="inline-flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              {isPasskeyPending ? "Waiting for passkey..." : "Sign in with passkey"}
            </span>
          </Button>
          {lastMethod === "passkey" ? (
            <span className="type-label-small absolute -top-2 -right-2 rounded-full bg-[var(--ink-strong)] px-1.5 py-0.5 text-[var(--surface)]">
              Last used
            </span>
          ) : null}
        </div>

        {statusMessage ? (
          <p className="type-body-medium rounded-2xl bg-[var(--surface-container-lowest)] px-4 py-3 text-[var(--ink-strong)]">
            {statusMessage}
          </p>
        ) : null}

        {errorMessage ? (
          <p className="type-body-medium rounded-2xl bg-red-50 px-4 py-3 text-red-700">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <div className="space-y-3 pt-4">
        <div className="rounded-[1.4rem] border border-[var(--border)] bg-[var(--surface-container-lowest)] p-5">
          <p className="type-title-small text-[var(--ink-strong)]">Access policy</p>
          <p className="type-body-medium mt-2 text-[var(--ink-soft)]">
            Atlas keeps public discovery open, but the operator workspace is invite-only.
          </p>
        </div>
        {authConfig.localMode ? (
          <div className="rounded-[1.4rem] border border-[var(--border)] bg-[var(--surface-container-lowest)] p-5">
            <p className="type-title-small text-[var(--ink-strong)]">Local mode is active</p>
            <p className="type-body-medium mt-2 text-[var(--ink-soft)]">
              Auth is disabled in local mode, so you can open the admin workspace without signing
              in.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
