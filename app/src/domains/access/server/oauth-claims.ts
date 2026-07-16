import "@tanstack/react-start/server-only";

import {
  API_KEY_SCOPES,
  scopesToPermissions,
  type ApiKeyScope,
} from "@rebuildingamerica/atlas-access/api-key-scopes";
import { resolveCapabilities, type AtlasCapability, type AtlasProduct } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import { MCP_ENTERPRISE_SCOPE } from "@rebuildingamerica/atlas-access/oauth-as-metadata";

/**
 * Prefix used by OAuth clients to request organization context in access
 * tokens.  A client requests scope `org:{org_id}` during authorization; the
 * claims builder validates membership and includes the org_id in the token.
 */
const ORG_SCOPE_PREFIX = "org:";
const OAUTH_CAPABILITY_SCOPES: readonly AtlasCapability[] = [MCP_ENTERPRISE_SCOPE];

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
   * `ATLAS_AUTH_JWT_AUDIENCES` so the binding stays consistent with the resource
   * server's audience-validation logic.
   */
  defaultAudience: string | null;
  /**
   * Resolves the user's primary workspace id when the OAuth client did not
   * request an `org:{id}` scope.  Tests inject a deterministic stub here so
   * we don't need a Better Auth database to exercise the claim shape.
   */
  resolvePrimaryWorkspaceId?: (userId: string) => Promise<string | null>;
  /**
   * Resolves active product grants for the workspace being encoded into the
   * access token. Capability claims are derived from these products rather
   * than copied from user-requested OAuth scopes.
   */
  resolveActiveProductsForWorkspace?: (workspaceId: string) => Promise<AtlasProduct[]>;
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
 * Narrows OAuth scopes down to Atlas capability scopes that must be proven
 * against the selected workspace's active products before they are emitted in
 * an access-token claim.
 */
function collectAtlasCapabilityScopes(scopes: readonly string[]): AtlasCapability[] {
  const requestedCapabilities: AtlasCapability[] = [];
  for (const scope of scopes) {
    const isAtlasCapability = (OAUTH_CAPABILITY_SCOPES as readonly string[]).includes(scope);
    if (isAtlasCapability) {
      requestedCapabilities.push(scope as AtlasCapability);
    }
  }
  return requestedCapabilities;
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
 * When no `org:` scope is present and the user belongs to exactly one
 * workspace, Atlas falls back to that workspace id so MCP clients (which
 * have no way to discover the right workspace at registration time) don't
 * dead-end at `require_org_actor`'s 403.
 *
 * @param params - Better Auth's custom-claim payload.
 * @param options - Atlas runtime hooks (default audience, workspace lookup).
 */
export async function buildAtlasAccessTokenClaims(
  params: OAuthAccessTokenClaimsParams,
  options: BuildAtlasClaimsOptions,
): Promise<Record<string, unknown>> {
  const { scopes, resource, user } = params;
  const resourceScopes = collectAtlasResourceScopes(scopes);
  const capabilityScopes = collectAtlasCapabilityScopes(scopes);
  let orgId = extractOrgIdFromScopes(scopes);

  if (!orgId && user?.id && options.resolvePrimaryWorkspaceId) {
    orgId = await options.resolvePrimaryWorkspaceId(user.id);
  }

  let capabilityClaims: AtlasCapability[] = [];
  if (orgId && capabilityScopes.length > 0 && options.resolveActiveProductsForWorkspace) {
    const activeProducts = await options.resolveActiveProductsForWorkspace(orgId);
    const resolved = resolveCapabilities(activeProducts);
    capabilityClaims = capabilityScopes.filter((capability) =>
      resolved.capabilities.has(capability),
    );
  }

  const claims: Record<string, unknown> = {
    permissions: scopesToPermissions(resourceScopes),
  };

  if (capabilityClaims.length > 0) {
    claims.capabilities = capabilityClaims;
  }

  if (orgId) {
    claims.org_id = orgId;
  }

  const audience = resource ?? options.defaultAudience;
  if (audience) {
    claims.aud = audience;
  }

  return claims;
}
