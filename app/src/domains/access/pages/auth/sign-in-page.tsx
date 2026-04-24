import { Link } from "@tanstack/react-router";
import { Info, KeyRound, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { getAuthClient } from "@/domains/access/client/auth-client";
import { setLastUsedAtlasLoginMethod } from "@/domains/access/client/last-login-method";
import { waitForAtlasAuthenticatedSession } from "@/domains/access/client/session-confirmation";
import { getAuthConfig } from "@/domains/access/config";
import { requestMagicLink } from "@/domains/access/session.functions";
import { resolveWorkspaceSSOSignIn } from "@/domains/access/sso.functions";
import {
  buildMagicLinkStatusMessage,
  buildSignInCallbackURL,
  buildSignInErrorCallbackURL,
  extractSSORedirectUrl,
} from "./sign-in-page-helpers";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";

/**
 * Search params accepted by the sign-in route.
 */
export const signInSearchSchema = z.object({
  email: z.string().optional(),
  existing: z.coerce.boolean().optional(),
  invitation: z.string().optional(),
  redirect: z.string().optional(),
});

/**
 * Props accepted by the sign-in page.
 */
interface SignInPageProps {
  existingAccount?: boolean;
  initialEmail?: string;
  invitationId?: string;
  redirectTo?: string;
}

/**
 * Sign-in experience for Atlas operator access.
 *
 * Atlas resolves enterprise providers server-side from the submitted email
 * address before falling back to the privacy-preserving magic-link path.
 */
export function SignInPage({
  existingAccount,
  initialEmail,
  invitationId,
  redirectTo,
}: SignInPageProps) {
  const authConfig = getAuthConfig();
  const authClient = getAuthClient();
  const lastMethod = authClient.getLastUsedLoginMethod();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEmailFlowPending, setIsEmailFlowPending] = useState(false);
  const [isPasskeyPending, setIsPasskeyPending] = useState(false);

  const isInvitationFlow = Boolean(invitationId);
  const callbackURL = buildSignInCallbackURL(invitationId, redirectTo);
  const errorCallbackURL = buildSignInErrorCallbackURL(invitationId, redirectTo);

  useEffect(() => {
    if (
      typeof PublicKeyCredential === "undefined" ||
      typeof PublicKeyCredential.isConditionalMediationAvailable !== "function"
    ) {
      return;
    }

    let active = true;

    const startConditionalPasskeyAutofill = async () => {
      try {
        const conditionalMediationAvailabilityPromise =
          PublicKeyCredential.isConditionalMediationAvailable();
        const conditionalMediationAvailable = await conditionalMediationAvailabilityPromise;

        if (!conditionalMediationAvailable || !active) {
          return;
        }

        const passkeySignInPromise = authClient.signIn.passkey({
          autoFill: true,
          fetchOptions: {
            onSuccess: async () => {
              if (!active) {
                return;
              }

              const sessionConfirmationPromise = waitForAtlasAuthenticatedSession();
              await sessionConfirmationPromise;
              setLastUsedAtlasLoginMethod("passkey");
              window.location.assign(callbackURL);
            },
          },
        });

        await passkeySignInPromise;
      } catch {
        return;
      }
    };

    void startConditionalPasskeyAutofill();

    return () => {
      active = false;
    };
  }, [authClient, callbackURL]);

  const handleEmailContinue = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    setIsEmailFlowPending(true);

    try {
      const ssoResolutionPromise = resolveWorkspaceSSOSignIn({
        data: {
          email,
          invitationId,
        },
      });
      const ssoResolution = await ssoResolutionPromise;

      if (ssoResolution) {
        const organizationLabel = ssoResolution.organizationName ?? "your organization";

        setStatusMessage(`Redirecting to ${organizationLabel}'s sign-in...`);

        const ssoSignInPromise = authClient.signIn.sso({
          callbackURL,
          email,
          errorCallbackURL,
          loginHint: email,
          providerId: ssoResolution.providerId,
          providerType: ssoResolution.providerType,
        });
        const ssoResult = await ssoSignInPromise;
        const redirectUrl = extractSSORedirectUrl(ssoResult);

        if (redirectUrl) {
          window.location.assign(redirectUrl);
        }

        return;
      }

      const magicLinkRequestPromise = requestMagicLink({
        data: {
          callbackURL,
          email,
        },
      });

      await magicLinkRequestPromise;
      setLastUsedAtlasLoginMethod("magic-link");
      setStatusMessage(buildMagicLinkStatusMessage(invitationId));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sign-in is temporarily unavailable.";
      setErrorMessage(message);
    } finally {
      setIsEmailFlowPending(false);
    }
  };

  const handlePasskey = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsPasskeyPending(true);

    try {
      const passkeySignInPromise = authClient.signIn.passkey();
      const result = await passkeySignInPromise;

      if (result.error) {
        throw new Error(result.error.message || "Could not sign in with a passkey.");
      }

      const sessionConfirmationPromise = waitForAtlasAuthenticatedSession();
      await sessionConfirmationPromise;
      setLastUsedAtlasLoginMethod("passkey");
      window.location.assign(callbackURL);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not sign in with a passkey.";
      setErrorMessage(message);
    } finally {
      setIsPasskeyPending(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="type-label-medium text-outline">
          {isInvitationFlow ? "Workspace invitation" : "Account access"}
        </p>
        <h1 className="type-display-small text-on-surface">
          {isInvitationFlow ? "Accept your workspace invitation" : "Sign in to Atlas"}
        </h1>
        <p className="type-body-large text-outline">
          {isInvitationFlow
            ? "Enter the email address where you received the invitation."
            : "Use your passkey, or enter your email for a sign-in link."}
        </p>
      </div>

      {existingAccount ? (
        <div className="flex items-start gap-3 rounded-2xl bg-blue-50 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          <p className="type-body-medium text-blue-800">
            Looks like you already have an account. Sign in below.
          </p>
        </div>
      ) : null}

      <div className="space-y-5">
        <div className="relative inline-block">
          <Button
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
            <span className="type-label-small bg-inverse-surface text-inverse-on-surface absolute -top-2 -right-2 rounded-full px-1.5 py-0.5">
              Last used
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-border h-px flex-1" />
          <span className="type-label-small text-outline">or</span>
          <div className="bg-border h-px flex-1" />
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            void handleEmailContinue(e);
          }}
        >
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="username webauthn"
            required
            icon={<Mail className="h-4 w-4" />}
          />

          <div className="relative inline-block">
            <Button
              type="submit"
              variant="secondary"
              disabled={isEmailFlowPending || authConfig.localMode || !email.trim()}
            >
              {isEmailFlowPending ? "Continuing..." : "Continue with email"}
            </Button>
            {lastMethod === "magic-link" ? (
              <span className="type-label-small bg-inverse-surface text-inverse-on-surface absolute -top-2 -right-2 rounded-full px-1.5 py-0.5">
                Last used
              </span>
            ) : null}
          </div>
        </form>

        {statusMessage ? (
          <p className="type-body-medium bg-surface-container-lowest text-on-surface rounded-2xl px-4 py-3">
            {statusMessage}
          </p>
        ) : null}

        {errorMessage ? (
          <p className="type-body-medium rounded-2xl bg-red-50 px-4 py-3 text-red-700">
            {errorMessage}
          </p>
        ) : null}
      </div>

      {authConfig.localMode ? (
        <div className="border-outline-variant bg-surface-container-lowest rounded-[1.4rem] border p-5">
          <p className="type-body-medium text-outline">Sign-in is disabled in this environment.</p>
        </div>
      ) : null}

      {!isInvitationFlow ? (
        <p className="type-body-medium text-outline">
          New to Atlas?{" "}
          <Link to="/sign-up" className="text-accent type-label-medium hover:underline">
            Create a free account &rarr;
          </Link>
        </p>
      ) : null}
    </div>
  );
}
