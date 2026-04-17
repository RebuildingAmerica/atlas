/**
 * Builds the app-local callback path used after sign-in completes.
 *
 * @param invitationId - The optional workspace invitation id.
 * @param redirectTo - The optional explicit redirect path.
 */
export function buildSignInCallbackURL(invitationId?: string, redirectTo?: string): string {
  if (redirectTo) {
    return redirectTo;
  }

  return invitationId ? "/organization" : "/account";
}

/**
 * Builds the sign-in route URL Atlas uses when an enterprise provider needs to
 * redirect back to the email-first sign-in screen with the original context.
 *
 * @param invitationId - The optional workspace invitation id.
 * @param redirectTo - The optional explicit redirect path.
 */
export function buildSignInErrorCallbackURL(invitationId?: string, redirectTo?: string): string {
  const searchParams = new URLSearchParams();

  if (invitationId) {
    searchParams.set("invitation", invitationId);
  }

  if (redirectTo) {
    searchParams.set("redirect", redirectTo);
  }

  const queryString = searchParams.toString();

  return queryString ? `/sign-in?${queryString}` : "/sign-in";
}

/**
 * Builds the non-enumerating success message Atlas shows after a magic-link
 * request.
 *
 * @param invitationId - The optional workspace invitation id.
 */
export function buildMagicLinkStatusMessage(invitationId?: string): string {
  if (invitationId) {
    return "If the email can access Atlas, a sign-in link is on the way so you can review the invitation.";
  }

  return "If the email can access Atlas, a sign-in link is on the way.";
}

/**
 * Extracts a redirect URL from a Better Auth client response when the SSO
 * client returns one explicitly instead of navigating the browser itself.
 *
 * @param value - The raw Better Auth client response.
 */
export function extractSSORedirectUrl(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("data" in value)) {
    return null;
  }

  const responseData = value.data;

  if (!responseData || typeof responseData !== "object" || !("url" in responseData)) {
    return null;
  }

  const redirectUrl = responseData.url;

  return typeof redirectUrl === "string" ? redirectUrl : null;
}
