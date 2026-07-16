import { createFileRoute } from "@tanstack/react-router";
import { buildProtectedResourceMetadata } from "@rebuildingamerica/atlas-access/oauth-as-metadata";

async function loadRuntimeModule() {
  if (import.meta.env.SSR) {
    return await import("@/domains/access/server/runtime");
  }

  throw new Error("Auth runtime is only available on the server.");
}

/**
 * RFC 9728 metadata URL for Atlas's `/mcp` protected resource.
 *
 * For a resource URL of `${origin}/mcp`, clients derive this document at
 * `${origin}/.well-known/oauth-protected-resource/mcp`.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource/mcp")({
  server: {
    handlers: {
      GET: async () => {
        const { getAuthRuntimeConfig } = await loadRuntimeModule();
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
