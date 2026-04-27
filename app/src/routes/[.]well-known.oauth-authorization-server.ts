import { createFileRoute } from "@tanstack/react-router";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";

/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata.
 *
 * Better Auth serves the OIDC discovery document under
 * /api/auth/.well-known/openid-configuration via its catch-all, but generic
 * OAuth 2.1 / MCP clients prefer the AS metadata document at the canonical
 * root .well-known location.  This route surfaces the same parameters in the
 * RFC 8414 shape so those clients can discover Atlas without an out-of-band
 * configuration step.
 */
export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      GET: () => {
        const runtime = getAuthRuntimeConfig();
        const issuer = `${runtime.publicBaseUrl}/api/auth`;

        const metadata = {
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
          token_endpoint_auth_methods_supported: [
            "client_secret_basic",
            "client_secret_post",
            "none",
          ],
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

        return new Response(JSON.stringify(metadata), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
