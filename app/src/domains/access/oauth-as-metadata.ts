/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata payload.
 *
 * Atlas exposes the same document at two `.well-known` URLs to satisfy
 * different client expectations:
 *
 * - `/.well-known/oauth-authorization-server` — the common convention used by
 *   most MCP clients and tutorials.
 * - `/.well-known/oauth-authorization-server/api/auth` — the strict RFC 8414
 *   §3 location for Atlas's actual issuer (`${publicBaseUrl}/api/auth`).
 *
 * Both routes import this helper so the body stays in sync.
 */

interface AuthorizationServerMetadataInput {
  publicBaseUrl: string;
}

/**
 * Builds the RFC 8414 authorization-server metadata document for Atlas.
 *
 * @param input - The runtime configuration that determines the public origin
 *   used for issuer and endpoint URLs.
 */
export function buildAuthorizationServerMetadata(input: AuthorizationServerMetadataInput) {
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
    scopes_supported: [
      "openid",
      "profile",
      "email",
      "offline_access",
      "discovery:read",
      "discovery:write",
      "entities:write",
    ],
  };
}
