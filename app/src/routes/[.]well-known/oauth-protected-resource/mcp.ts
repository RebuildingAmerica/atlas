import { createFileRoute } from "@tanstack/react-router";
import { buildProtectedResourceMetadata } from "@/domains/access/oauth-as-metadata";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";

/**
 * RFC 9728 metadata URL for Atlas's `/mcp` protected resource.
 *
 * For a resource URL of `${origin}/mcp`, clients derive this document at
 * `${origin}/.well-known/oauth-protected-resource/mcp`.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource/mcp")({
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
