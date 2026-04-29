import { Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { getAuthClient } from "@/domains/access/client/auth-client";
import { setLastUsedAtlasLoginMethod } from "@/domains/access/client/last-login-method";
import {
  rememberLastUsedAtlasEmail,
  readLastUsedAtlasEmail,
} from "@/domains/access/client/last-used-email";
import { suggestEmailDomainCorrection } from "@/domains/access/email-domain-suggestions";
import { describeSsoError } from "@/domains/access/sso-error-messages";
import { recordSsoDiagnostics } from "@/domains/access/client/sso-diagnostics-log";
import { waitForAtlasAuthenticatedSession } from "@/domains/access/client/session-confirmation";
import { requestMagicLink } from "@/domains/access/session.functions";
import {
  buildAuthErrorLabels,
  describePasskeyError,
  extractAuthErrorCode,
} from "@/domains/access/auth-errors";
import { resolveWorkspaceSSOSignIn } from "@/domains/access/sso.functions";
import {
  buildMagicLinkStatusMessage,
  buildSignInCallbackURL,
  buildSignInErrorCallbackURL,
  extractSSORedirectUrl,
  isOAuthOriginSignIn,
  parsePricingIntent,
  resolveSignInHeadingCopy,
} from "./sign-in-page-helpers";
import { SignInEmailForm } from "./components/sign-in-email-form";
import { SignInPasskeyButton } from "./components/sign-in-passkey-button";
import { SignInStatusBlocks } from "./components/sign-in-status-blocks";

const MAGIC_LINK_ERROR_LABELS = buildAuthErrorLabels("sign-in");

/**
 * Search params accepted by the sign-in route.
 */
export const signInSearchSchema = z.object({
  email: z.string().optional(),
  error: z.string().optional(),
  existing: z.coerce.boolean().optional(),
  invitation: z.string().optional(),
  redirect: z.string().optional(),
});

interface SignInPageProps {
  errorCode?: string;
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
  errorCode,
  existingAccount,
  initialEmail,
  invitationId,
  redirectTo,
}: SignInPageProps) {
  const authClient = getAuthClient();
  const [lastMethod] = useState<string | null>(() => authClient.getLastUsedLoginMethod() ?? null);
  const [email, setEmail] = useState(() => initialEmail ?? readLastUsedAtlasEmail() ?? "");
  const domainSuggestion = useMemo(() => suggestEmailDomainCorrection(email), [email]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [captureMailboxUrl, setCaptureMailboxUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEmailFlowPending, setIsEmailFlowPending] = useState(false);
  const [isPasskeyPending, setIsPasskeyPending] = useState(false);

  const isInvitationFlow = Boolean(invitationId);
  const callbackURL = buildSignInCallbackURL(invitationId, redirectTo);
  const errorCallbackURL = buildSignInErrorCallbackURL(invitationId, redirectTo);
  const pricingIntent = useMemo(() => parsePricingIntent(redirectTo), [redirectTo]);
  const oauthOriginSignIn = useMemo(() => isOAuthOriginSignIn(redirectTo), [redirectTo]);
  const ssoErrorMessage = useMemo(() => describeSsoError(errorCode), [errorCode]);

  useEffect(() => {
    if (!errorCode) return;
    recordSsoDiagnostics({
      code: errorCode,
      email: initialEmail ?? null,
      message: ssoErrorMessage,
      workspaceSlug: null,
    });
  }, [errorCode, initialEmail, ssoErrorMessage]);

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
        const conditionalMediationAvailable =
          await PublicKeyCredential.isConditionalMediationAvailable();

        if (!conditionalMediationAvailable || !active) {
          return;
        }

        await authClient.signIn.passkey({
          autoFill: true,
          fetchOptions: {
            onSuccess: async () => {
              if (!active) {
                return;
              }
              await waitForAtlasAuthenticatedSession();
              setLastUsedAtlasLoginMethod("passkey");
              window.location.assign(callbackURL);
            },
          },
        });
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
      const ssoResolution = await resolveWorkspaceSSOSignIn({
        data: { email, invitationId },
      });

      if (ssoResolution) {
        const organizationLabel = ssoResolution.organizationName ?? "your organization";
        setStatusMessage(`Redirecting to ${organizationLabel}'s sign-in...`);

        const ssoResult = await authClient.signIn.sso({
          callbackURL,
          email,
          errorCallbackURL,
          loginHint: email,
          providerId: ssoResolution.providerId,
          providerType: ssoResolution.providerType,
        });
        const redirectUrl = extractSSORedirectUrl(ssoResult);

        if (redirectUrl) {
          rememberLastUsedAtlasEmail(email);
          window.location.assign(redirectUrl);
        }

        return;
      }

      const magicLinkResult = await requestMagicLink({
        data: { callbackURL, email },
      });
      setCaptureMailboxUrl(magicLinkResult.captureMailboxUrl ?? null);
      setLastUsedAtlasLoginMethod("magic-link");
      rememberLastUsedAtlasEmail(email);
      setStatusMessage(buildMagicLinkStatusMessage(invitationId));
    } catch (error) {
      const code = extractAuthErrorCode(error);
      setErrorMessage(code ? MAGIC_LINK_ERROR_LABELS[code] : "Sign-in is temporarily unavailable.");
    } finally {
      setIsEmailFlowPending(false);
    }
  };

  const handlePasskey = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsPasskeyPending(true);

    try {
      const result = await authClient.signIn.passkey();

      if (result.error) {
        setErrorMessage(describePasskeyError(result.error.message));
        return;
      }

      await waitForAtlasAuthenticatedSession();
      setLastUsedAtlasLoginMethod("passkey");
      window.location.assign(callbackURL);
    } catch {
      setErrorMessage("Passkey sign-in failed. Please try again.");
    } finally {
      setIsPasskeyPending(false);
    }
  };

  const { eyebrow, heading, subhead } = resolveSignInHeadingCopy({
    isInvitationFlow,
    pricingIntent,
  });

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="type-label-medium text-outline">{eyebrow}</p>
        <h1 className="type-display-small text-on-surface">{heading}</h1>
        <p className="type-body-large text-outline">{subhead}</p>
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
        <SignInPasskeyButton
          isLastUsed={lastMethod === "passkey"}
          isPending={isPasskeyPending}
          onClick={() => {
            void handlePasskey();
          }}
        />

        <div className="flex items-center gap-3">
          <div className="bg-border h-px flex-1" />
          <span className="type-label-small text-outline">or</span>
          <div className="bg-border h-px flex-1" />
        </div>

        <SignInEmailForm
          domainSuggestion={domainSuggestion}
          email={email}
          isLastUsed={lastMethod === "magic-link"}
          isPending={isEmailFlowPending}
          onEmailChange={setEmail}
          onSubmit={(e) => {
            void handleEmailContinue(e);
          }}
        />

        <SignInStatusBlocks
          captureMailboxUrl={captureMailboxUrl}
          errorCode={errorCode}
          errorMessage={errorMessage}
          oauthOriginSignIn={oauthOriginSignIn}
          ssoErrorMessage={ssoErrorMessage}
          statusMessage={statusMessage}
        />
      </div>

      {!isInvitationFlow ? (
        <p className="type-body-medium text-outline">
          New to Atlas?{" "}
          <Link
            to="/sign-up"
            search={redirectTo ? { redirect: redirectTo } : undefined}
            className="text-accent type-label-medium hover:underline"
          >
            Create a free account &rarr;
          </Link>
        </p>
      ) : null}
    </div>
  );
}
