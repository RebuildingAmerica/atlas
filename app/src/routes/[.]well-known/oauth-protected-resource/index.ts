import { createFileRoute } from "@tanstack/react-router";
import { buildProtectedResourceMetadata } from "@/domains/access/oauth-as-metadata";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";

/**
 * RFC 9728 OAuth 2.0 Protected Resource Metadata for the Atlas MCP server.
 *
 * MCP clients fetch this document — either by following the `resource_metadata`
 * pointer in the API's 401 `WWW-Authenticate` challenge or by probing this
 * well-known URL directly — to discover the authorization server, the
 * supported scopes, and the bearer-token presentation format.
 *
 * The payload is rebuilt per request from `getAuthRuntimeConfig()` so that
 * preview and staging deployments publish their own origin instead of the
 * production canonical URI.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource/")({
  server: {
    handlers: {
      GET: () => {
        const metadata = buildProtectedResourceMetadata(getAuthRuntimeConfig());

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
