/**
 * Pure helpers shared by the OAuth consent surface.  Extracted so the
 * page component stays focused on layout and the predicates can be unit-
 * tested without React.
 */

/**
 * Returns the hostname Atlas should display next to the consent prompt
 * when the redirect URI is meaningful (CIMD clients, dynamically
 * registered clients).  Returns null for invalid URIs so callers can
 * hide the line.
 */
export function safeRedirectHostname(redirectUri: string | undefined): string | null {
  if (!redirectUri) return null;
  try {
    return new URL(redirectUri).host;
  } catch {
    return null;
  }
}

/**
 * True when `clientId` looks like a Client ID Metadata Document URL.  A
 * URL-shaped `client_id` triggers extra UI affordances (showing the
 * client_id origin, calling out the document model) so the operator can
 * tell whether the request comes from a CIMD client.
 */
export function isUrlShapedClientId(clientId: string): boolean {
  return clientId.startsWith("https://");
}

const ORG_SCOPE_PREFIX = "org:";

/**
 * Returns true when the requested scope already pins an organization
 * with `org:{id}`.  When this is the case the consent UI hides the
 * picker and defers to the explicit scope so the chosen workspace is
 * what the customAccessTokenClaims callback ultimately binds.
 */
export function scopeAlreadyPinsOrg(scope: string | undefined): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).some((token) => token.startsWith(ORG_SCOPE_PREFIX));
}

/**
 * Composes the final scope string Atlas sends to Better Auth's consent
 * endpoint.  When the requesting client did not bind a workspace
 * explicitly and the operator picked one in the picker, append
 * `org:{id}` so the JWT's `org_id` claim flows from the chosen
 * workspace.
 */
export function withWorkspaceScope(scope: string | undefined, workspaceId: string | null): string {
  const base = scope?.trim() ?? "";
  if (!workspaceId || scopeAlreadyPinsOrg(base)) {
    return base;
  }
  return base ? `${base} ${ORG_SCOPE_PREFIX}${workspaceId}` : `${ORG_SCOPE_PREFIX}${workspaceId}`;
}
