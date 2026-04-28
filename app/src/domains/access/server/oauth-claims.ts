import "@tanstack/react-start/server-only";

import { API_KEY_SCOPES, scopesToPermissions, type ApiKeyScope } from "../api-key-scopes";

/**
 * Prefix used by OAuth clients to request organization context in access
 * tokens.  A client requests scope `org:{org_id}` during authorization; the
 * claims builder validates membership and includes the org_id in the token.
 */
const ORG_SCOPE_PREFIX = "org:";

/**
 * Parameters provided by Better Auth's oauthProvider plugin to the
 * customAccessTokenClaims callback.  Defined locally so the helper does not
 * depend on Better Auth's internal types.
 */
export interface OAuthAccessTokenClaimsParams {
  metadata?: Record<string, unknown>;
  referenceId?: string;
  resource?: string;
  scopes: string[];
  user?: (Record<string, unknown> & { id: string }) | null;
}

/**
 * Atlas-controlled options for `buildAtlasAccessTokenClaims`.
 */
export interface BuildAtlasClaimsOptions {
  /**
   * The fallback audience Atlas binds to access tokens when the OAuth client
   * does not pass an explicit `resource` parameter (RFC 8707).  Sourced from
   * `ATLAS_API_AUDIENCE` so the binding stays consistent with the resource
   * server's audience-validation logic.
   */
  defaultAudience: string | null;
}

/**
 * Narrows OAuth scopes down to the Atlas resource scopes we expose through
 * API keys and OAuth access tokens.
 */
function collectAtlasResourceScopes(scopes: readonly string[]): ApiKeyScope[] {
  const resourceScopes: ApiKeyScope[] = [];
  for (const scope of scopes) {
    const isAtlasScope = (API_KEY_SCOPES as readonly string[]).includes(scope);
    if (isAtlasScope) {
      resourceScopes.push(scope as ApiKeyScope);
    }
  }
  return resourceScopes;
}

/**
 * Extracts the organization ID from an `org:{id}` scope, if present.
 */
function extractOrgIdFromScopes(scopes: readonly string[]): string | null {
  for (const scope of scopes) {
    if (scope.startsWith(ORG_SCOPE_PREFIX) && scope.length > ORG_SCOPE_PREFIX.length) {
      return scope.slice(ORG_SCOPE_PREFIX.length);
    }
  }
  return null;
}

/**
 * Builds Atlas-specific OAuth access-token claims from Better Auth's scope
 * payload.
 *
 * The MCP authorization spec (§"Resource Parameter Implementation") requires
 * the issued access token to be bound to the `resource` parameter the client
 * supplied at the authorization and token endpoints (RFC 8707).  Atlas
 * encodes that binding in the JWT `aud` claim from the callback so it does
 * not depend on Better Auth's `validAudiences` static configuration.
 *
 * When the OAuth client requests the `org:{org_id}` scope during
 * authorization, the resolved org_id is included in the access token so the
 * API backend can enforce organization context without a separate lookup.
 *
 * @param params - Better Auth's custom-claim payload.
 * @param options - Atlas runtime hooks (e.g., default audience fallback).
 */
export function buildAtlasAccessTokenClaims(
  params: OAuthAccessTokenClaimsParams,
  options: BuildAtlasClaimsOptions,
): Record<string, unknown> {
  const { scopes, resource } = params;
  const resourceScopes = collectAtlasResourceScopes(scopes);
  const orgId = extractOrgIdFromScopes(scopes);

  const claims: Record<string, unknown> = {
    permissions: scopesToPermissions(resourceScopes),
  };

  if (orgId) {
    claims.org_id = orgId;
  }

  const audience = resource ?? options.defaultAudience;
  if (audience) {
    claims.aud = audience;
  }

  return claims;
}
