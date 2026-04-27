import { createFileRoute } from "@tanstack/react-router";
import { buildAuthorizationServerMetadata } from "@/domains/access/oauth-as-metadata";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";

/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata at the conventional root
 * `.well-known` URL.  Most MCP clients and OAuth 2.1 tutorials look here
 * first; Atlas mirrors the document at the strict RFC 8414 §3 path under
 * `/api/auth` for clients that follow the issuer-suffix construction.
 */
export const Route = createFileRoute("/.well-known/oauth-authorization-server/")({
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
