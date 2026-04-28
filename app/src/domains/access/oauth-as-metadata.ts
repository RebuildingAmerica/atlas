import { API_KEY_SCOPES } from "./api-key-scopes";

/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata payload, plus the matching
 * RFC 9728 Protected Resource Metadata payload.  Atlas exposes both at
 * `.well-known` URLs to satisfy MCP authorization-spec discovery.
 *
 * AS metadata is mirrored at two paths so different MCP clients find it:
 *
 * - `/.well-known/oauth-authorization-server` — the common convention used by
 *   most MCP clients and tutorials.
 * - `/.well-known/oauth-authorization-server/api/auth` — the strict RFC 8414
 *   §3 location for Atlas's actual issuer (`${publicBaseUrl}/api/auth`).
 *
 * PRM is served at `/.well-known/oauth-protected-resource`, computed from the
 * runtime origin so previews and staging publish the right canonical URI.
 */

interface MetadataInput {
  publicBaseUrl: string;
}

/**
 * The OIDC + Atlas scopes Atlas advertises in both AS and PRM metadata.
 *
 * Spec §"Scope Selection Strategy" expects this set to be the *minimal* base
 * surface; richer scopes are negotiated per-request via the WWW-Authenticate
 * scope challenge instead of being enumerated here.
 */
export const SUPPORTED_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  ...API_KEY_SCOPES,
] as const;

/**
 * Builds the RFC 8414 authorization-server metadata document for Atlas.
 *
 * @param input - The runtime configuration that determines the public origin
 *   used for issuer and endpoint URLs.
 */
export function buildAuthorizationServerMetadata(input: MetadataInput) {
  const issuer = `${input.publicBaseUrl}/api/auth`;

  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth2/authorize`,
    token_endpoint: `${issuer}/oauth2/token`,
    userinfo_endpoint: `${issuer}/oauth2/userinfo`,
    jwks_uri: `${issuer}/jwks`,
    registration_endpoint: `${issuer}/oauth2/register`,
    introspection_endpoint: `${issuer}/oauth2/introspect`,
    revocation_endpoint: `${issuer}/oauth2/revoke`,
    end_session_endpoint: `${issuer}/oauth2/end-session`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    code_challenge_methods_supported: ["S256"],
    id_token_signing_alg_values_supported: ["RS256", "ES256"],
    subject_types_supported: ["public"],
    scopes_supported: [...SUPPORTED_OAUTH_SCOPES],
    // Atlas implements `draft-ietf-oauth-client-id-metadata-document-00`
    // through the CIMD shim in `app/src/domains/access/server/cimd-handler.ts`
    // — URL-shaped client_ids resolve to a JSON metadata document that
    // materializes a synthetic Better Auth `oauthClient` row.
    client_id_metadata_document_supported: true,
  };
}

/**
 * Builds the RFC 9728 protected-resource metadata document for the Atlas MCP
 * surface.  The MCP server at `/mcp` and the REST API both share the same
 * canonical resource origin (`publicBaseUrl`) so a single PRM document
 * advertises the right authorization server for both.
 *
 * @param input - The runtime configuration that determines the canonical
 *   resource URI advertised to MCP clients.
 */
export function buildProtectedResourceMetadata(input: MetadataInput) {
  return {
    resource: input.publicBaseUrl,
    authorization_servers: [`${input.publicBaseUrl}/api/auth`],
    bearer_methods_supported: ["header"],
    scopes_supported: [...SUPPORTED_OAUTH_SCOPES],
    resource_documentation: `${input.publicBaseUrl}/docs/mcp`,
  };
}
