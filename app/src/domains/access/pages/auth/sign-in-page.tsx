import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { getAuthClient } from "@/domains/access/client/auth-client";
import { setLastUsedAtlasLoginMethod } from "@/domains/access/client/last-login-method";
import {
  rememberLastUsedAtlasEmail,
  readLastUsedAtlasEmail,
} from "@/domains/access/client/last-used-email";
import { suggestEmailDomainCorrection } from "@rebuildingamerica/atlas-access/email-domain-suggestions";
import { describeSsoError } from "@rebuildingamerica/atlas-access/sso-error-messages";
import { recordSsoDiagnostics } from "@/domains/access/client/sso-diagnostics-log";
import { waitForAtlasAuthenticatedSession } from "@/domains/access/client/session-confirmation";
import { signalUnknownPasskey } from "@rebuildingamerica/atlas-access/passkey-signal";
import { requestMagicLink } from "@/domains/access/session.functions";
import {
  buildAuthErrorLabels,
  describePasskeyError,
  extractAuthErrorCode,
} from "@rebuildingamerica/atlas-access/auth-errors";
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
import { SignInEmailForm } from "@rebuildingamerica/atlas-access/components/sign-in-email-form";
import { SignInPasskeyButton } from "./components/sign-in-passkey-button";
import { SignInStatusBlocks } from "./components/sign-in-status-blocks";

const MAGIC_LINK_ERROR_LABELS = buildAuthErrorLabels("sign-in");

function normalizeUsernameInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("@")) return trimmed.slice(1).toLowerCase();
  if (!trimmed.includes("@") && trimmed.includes(".")) return trimmed.toLowerCase();
  return null;
}

/**
 * Search params accepted by the sign-in route.
 */
export const signInSearchSchema = z.object({
  email: z.string().optional(),
  error: z.string().optional(),
  invitation: z.string().optional(),
  redirect: z.string().optional(),
});

interface SignInPageProps {
  errorCode?: string;
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
export function SignInPage({ errorCode, initialEmail, invitationId, redirectTo }: SignInPageProps) {
  const authClient = getAuthClient();
  const [lastMethod, setLastMethod] = useState<string | null>(null);
  const [email, setEmail] = useState(initialEmail ?? "");
  const domainSuggestion = useMemo(() => suggestEmailDomainCorrection(email), [email]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [captureMailboxUrl, setCaptureMailboxUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEmailFallbackVisible, setIsEmailFallbackVisible] = useState(false);
  const [isEmailFlowPending, setIsEmailFlowPending] = useState(false);
  const [isPasskeyPending, setIsPasskeyPending] = useState(false);

  const isInvitationFlow = Boolean(invitationId);
  const emailFallbackVisible = isInvitationFlow || isEmailFallbackVisible;
  const callbackURL = buildSignInCallbackURL(invitationId, redirectTo);
  const errorCallbackURL = buildSignInErrorCallbackURL(invitationId, redirectTo);
  const pricingIntent = useMemo(() => parsePricingIntent(redirectTo), [redirectTo]);
  const oauthOriginSignIn = useMemo(() => isOAuthOriginSignIn(redirectTo), [redirectTo]);
  const ssoErrorMessage = useMemo(() => describeSsoError(errorCode), [errorCode]);

  useEffect(() => {
    setLastMethod(authClient.getLastUsedLoginMethod() ?? null);

    if (initialEmail !== undefined) {
      return;
    }

    const rememberedEmail = readLastUsedAtlasEmail();
    if (!rememberedEmail) {
      return;
    }

    setEmail((currentEmail) => currentEmail || rememberedEmail);
  }, [authClient, initialEmail]);

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

        const result = await authClient.signIn.passkey({
          autoFill: true,
          returnWebAuthnResponse: true,
          fetchOptions: {
            onError: () => {
              return;
            },
            onSuccess: async () => {
              if (!active) {
                return;
              }
              await waitForAtlasAuthenticatedSession();
              setLastUsedAtlasLoginMethod("passkey");
              setLastMethod("passkey");
              window.location.assign(callbackURL);
            },
          },
        });

        if (
          result.error &&
          "code" in result.error &&
          result.error.code === "PASSKEY_NOT_FOUND" &&
          "webauthn" in result
        ) {
          signalUnknownPasskey(result.webauthn.response.id);
        }
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

    const username = normalizeUsernameInput(email);
    if (username) {
      startUsernameSignIn(username);
      return;
    }

    if (!emailFallbackVisible) {
      setIsEmailFallbackVisible(true);
      return;
    }

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
      setLastMethod("magic-link");
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
      const result = await authClient.signIn.passkey({ returnWebAuthnResponse: true });

      if (result.error) {
        if (
          "code" in result.error &&
          result.error.code === "PASSKEY_NOT_FOUND" &&
          "webauthn" in result
        ) {
          signalUnknownPasskey(result.webauthn.response.id);
        }
        setErrorMessage(describePasskeyError(result.error));
        return;
      }

      await waitForAtlasAuthenticatedSession();
      setLastUsedAtlasLoginMethod("passkey");
      setLastMethod("passkey");
      window.location.assign(callbackURL);
    } catch {
      setErrorMessage("Passkey sign-in failed. Please try again.");
    } finally {
      setIsPasskeyPending(false);
    }
  };

  const startUsernameSignIn = (handle: string) => {
    if (!handle) return;
    const params = new URLSearchParams({ handle, returnTo: redirectTo ?? "/account" });
    window.location.assign(`/api/atproto/sign-in/start?${params.toString()}`);
  };

  const { eyebrow, heading, subhead } = resolveSignInHeadingCopy({
    isInvitationFlow,
    pricingIntent,
  });

  return (
    <div className="space-y-7">
      <div className="space-y-3">
        {eyebrow ? <p className="type-label-medium text-outline">{eyebrow}</p> : null}
        <h1 className="type-display-small text-on-surface">{heading}</h1>
        <p className="type-body-large text-outline max-w-xl">{subhead}</p>
      </div>

      <div className="space-y-5">
        <SignInEmailForm
          domainSuggestion={domainSuggestion}
          email={email}
          isEmailFallbackVisible={emailFallbackVisible}
          isPending={isEmailFlowPending}
          onEmailChange={setEmail}
          onRevealEmailFallback={() => {
            setIsEmailFallbackVisible(true);
          }}
          onSubmit={(e) => {
            void handleEmailContinue(e);
          }}
          passkeyAction={
            <SignInPasskeyButton
              isLastUsed={lastMethod === "passkey"}
              isPending={isPasskeyPending}
              onClick={() => {
                void handlePasskey();
              }}
            />
          }
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
