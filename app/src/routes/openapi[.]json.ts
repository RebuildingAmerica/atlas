import { createFileRoute } from "@tanstack/react-router";

const PLAIN_TEXT = { "content-type": "text/plain; charset=utf-8" } as const;
const OPENAPI_CORS_HEADERS = {
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-origin": "*",
  "access-control-max-age": "86400",
} as const;

async function loadRuntimeModule() {
  if (import.meta.env.SSR) {
    return await import("@/domains/access/server/runtime");
  }

  throw new Error("Auth runtime is only available on the server.");
}

export const Route = createFileRoute("/openapi.json")({
  server: {
    handlers: {
      OPTIONS: () =>
        new Response(null, {
          headers: OPENAPI_CORS_HEADERS,
          status: 204,
        }),
      GET: async () => {
        const { getAuthRuntimeConfig } = await loadRuntimeModule();
        const { apiBaseUrl } = getAuthRuntimeConfig();

        if (!apiBaseUrl) {
          return new Response("Atlas API proxy target is not configured.", {
            headers: { ...PLAIN_TEXT, ...OPENAPI_CORS_HEADERS },
            status: 502,
          });
        }

        try {
          const apiResponse = await fetch(new URL("/openapi.json", apiBaseUrl), {
            signal: AbortSignal.timeout(5000),
          });

          return new Response(apiResponse.body, {
            headers: {
              ...Object.fromEntries(apiResponse.headers.entries()),
              ...OPENAPI_CORS_HEADERS,
            },
            status: apiResponse.status,
            statusText: apiResponse.statusText,
          });
        } catch {
          return new Response("Atlas OpenAPI document is unavailable.", {
            headers: { ...PLAIN_TEXT, ...OPENAPI_CORS_HEADERS },
            status: 503,
          });
        }
      },
    },
  },
});
