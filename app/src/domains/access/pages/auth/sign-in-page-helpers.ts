/**
 * Returns the candidate path when it is safe to use as a post-sign-in redirect,
 * otherwise null.  A safe path is a same-origin absolute path that cannot be
 * coerced into a cross-origin navigation by `window.location.assign`.
 *
 * @param candidate - The redirect target supplied via the `redirect` query
 *   parameter or related untrusted input.
 */
export function sanitizeSignInRedirectPath(candidate: string | undefined): string | null {
  if (!candidate || typeof candidate !== "string") {
    return null;
  }

  if (candidate.length === 0 || candidate.length > 2048) {
    return null;
  }

  if (!candidate.startsWith("/")) {
    return null;
  }

  // `//evil.example` and `/\evil.example` parse as protocol-relative or
  // backslash-prefixed authority components in some browsers, leaking the
  // user off-origin.
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) {
    return null;
  }

  return candidate;
}

/**
 * Builds the app-local callback path used after sign-in completes.
 *
 * @param invitationId - The optional workspace invitation id.
 * @param redirectTo - The optional explicit redirect path.
 */
export function buildSignInCallbackURL(invitationId?: string, redirectTo?: string): string {
  const sanitizedRedirect = sanitizeSignInRedirectPath(redirectTo);
  if (sanitizedRedirect !== null) {
    return sanitizedRedirect;
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

  const sanitizedRedirect = sanitizeSignInRedirectPath(redirectTo);
  if (sanitizedRedirect !== null) {
    searchParams.set("redirect", sanitizedRedirect);
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
    return "A sign-in link is on the way so you can review the invitation.";
  }

  return "A sign-in link is on the way. Check your inbox.";
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
