import type { AtlasProduct } from "@/domains/access/capabilities";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";

interface SignInHeadingCopy {
  eyebrow: string;
  heading: string;
  subhead: string;
}

/**
 * Resolves the eyebrow / heading / subhead copy shown atop the sign-in
 * page.  Routes the operator into one of four flows: workspace
 * invitation, research-pass purchase, generic paid-plan purchase, or
 * the default account-access flow.
 */
export function resolveSignInHeadingCopy(args: {
  isInvitationFlow: boolean;
  pricingIntent: AtlasProduct | null;
}): SignInHeadingCopy {
  const { isInvitationFlow, pricingIntent } = args;
  if (isInvitationFlow) {
    return {
      eyebrow: "Workspace invitation",
      heading: "Accept your workspace invitation",
      subhead: "Enter the email address where you received the invitation.",
    };
  }
  const intentLabel = pricingIntent ? PRODUCT_LABELS[pricingIntent] : null;
  if (intentLabel && pricingIntent === "atlas_research_pass") {
    return {
      eyebrow: intentLabel,
      heading: "Sign in to start your pass",
      subhead: "Continue with the email you use for Atlas, or create a free account below.",
    };
  }
  if (intentLabel) {
    return {
      eyebrow: intentLabel,
      heading: "Sign in to subscribe",
      subhead: "Continue with the email you use for Atlas, or create a free account below.",
    };
  }
  return {
    eyebrow: "Account access",
    heading: "Sign in to Atlas",
    subhead: "Use your passkey, or enter your email for a sign-in link.",
  };
}

const ATLAS_PRODUCTS: readonly AtlasProduct[] = [
  "atlas_pro",
  "atlas_team",
  "atlas_research_pass",
] as const;

/**
 * Parses a redirect path to detect a /pricing checkout intent.
 *
 * Returns the intended product when the redirect points back at /pricing
 * with a recognised intent param, otherwise null.  Used to swap heading
 * copy so a viewer who clicked a paid CTA isn't shown a generic "Sign in
 * to Atlas" page that ignores their context.
 *
 * @param redirectTo - The redirect path passed via search params.
 */
export function parsePricingIntent(redirectTo: string | undefined): AtlasProduct | null {
  if (!redirectTo) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(redirectTo, "http://atlas.local");
  } catch {
    return null;
  }

  if (url.pathname !== "/pricing") {
    return null;
  }

  const intent = url.searchParams.get("intent");
  if (!intent) {
    return null;
  }

  return ATLAS_PRODUCTS.find((product) => product === intent) ?? null;
}

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
 * Builds the app-local callback path used after sign-in completes.  The
 * default lands on /discovery rather than /account so an operator who just
 * signed in via SAML or magic link sees the workspace surface they came
 * for instead of the account-settings page.
 *
 * @param invitationId - The optional workspace invitation id.
 * @param redirectTo - The optional explicit redirect path.
 */
export function buildSignInCallbackURL(invitationId?: string, redirectTo?: string): string {
  const sanitizedRedirect = sanitizeSignInRedirectPath(redirectTo);
  if (sanitizedRedirect !== null) {
    return sanitizedRedirect;
  }

  return invitationId ? "/organization" : "/discovery";
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
 * Returns true when the sign-in page was reached from an OAuth authorization
 * redirect — i.e., the `redirect` query parameter points back into the
 * `/api/auth/oauth2/...` flow that Better Auth bounces unauthenticated users
 * through on their way to the consent screen.
 *
 * The signal is used to surface MCP-aware copy ("if you don't see a magic
 * link, your email may not be approved yet — request access at <link>")
 * without leaking allowlist membership: the hint shows for every OAuth-origin
 * submission, allowlisted or not, so a probe with someone else's email
 * cannot enumerate access state.
 *
 * @param redirectTo - The redirect path supplied via the `redirect` query
 *   parameter; same value the rest of the sign-in page consumes.
 */
export function isOAuthOriginSignIn(redirectTo: string | undefined): boolean {
  const sanitized = sanitizeSignInRedirectPath(redirectTo);
  if (!sanitized) {
    return false;
  }
  return sanitized.startsWith("/api/auth/oauth2/");
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
