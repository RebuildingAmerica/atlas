import { createFileRoute } from "@tanstack/react-router";
import { buildAuthorizationServerMetadata } from "@/domains/access/oauth-as-metadata";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";

/**
 * RFC 8414 §3 issuer-suffix path for the AS metadata document.  When the
 * issuer URI has a non-empty path component (Atlas's issuer is
 * `${publicBaseUrl}/api/auth`), strict OAuth 2.1 clients construct the
 * metadata URL by inserting `/.well-known/oauth-authorization-server`
 * between the host and the path of the issuer — i.e.
 * `${origin}/.well-known/oauth-authorization-server/api/auth`.  The body is
 * identical to the root variant; only the URL differs.
 */
export const Route = createFileRoute("/.well-known/oauth-authorization-server/api/auth")({
  server: {
    handlers: {
      GET: () => {
        const metadata = buildAuthorizationServerMetadata(getAuthRuntimeConfig());

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
