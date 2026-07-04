import { createFileRoute } from "@tanstack/react-router";

const PLAIN_TEXT = { "content-type": "text/plain; charset=utf-8" } as const;

async function loadRuntimeModule() {
  if (import.meta.env.SSR) {
    return await import("@/domains/access/server/runtime");
  }

  throw new Error("Auth runtime is only available on the server.");
}

export const Route = createFileRoute("/openapi.json")({
  server: {
    handlers: {
      GET: async () => {
        const { getAuthRuntimeConfig } = await loadRuntimeModule();
        const { apiBaseUrl } = getAuthRuntimeConfig();

        if (!apiBaseUrl) {
          return new Response("Atlas API proxy target is not configured.", {
            headers: PLAIN_TEXT,
            status: 502,
          });
        }

        try {
          const apiResponse = await fetch(`${apiBaseUrl}/openapi.json`, {
            signal: AbortSignal.timeout(5000),
          });

          return new Response(apiResponse.body, {
            headers: new Headers(apiResponse.headers),
            status: apiResponse.status,
            statusText: apiResponse.statusText,
          });
        } catch {
          return new Response("Atlas OpenAPI document is unavailable.", {
            headers: PLAIN_TEXT,
            status: 503,
          });
        }
      },
    },
  },
});
