import { createFileRoute } from "@tanstack/react-router";

const NO_STORE = { "Cache-Control": "no-store" } as const;

async function loadRuntimeModule() {
  if (import.meta.env.SSR) {
    return await import("@/domains/access/server/runtime");
  }

  throw new Error("Auth runtime is only available on the server.");
}

/**
 * Proxies the app health surface to the Python API when configured.
 */
export async function handleHealthGet(): Promise<Response> {
  const { getAuthRuntimeConfig } = await loadRuntimeModule();
  const { apiBaseUrl } = getAuthRuntimeConfig();

  if (!apiBaseUrl) {
    return Response.json({ status: "ok" }, { headers: NO_STORE });
  }

  try {
    const apiResponse = await fetch(new URL("/health", apiBaseUrl), {
      signal: AbortSignal.timeout(5000),
    });

    if (!apiResponse.ok) {
      return Response.json({ status: "degraded" }, { status: 503, headers: NO_STORE });
    }

    return Response.json({ status: "ok" }, { headers: NO_STORE });
  } catch {
    return Response.json({ status: "degraded" }, { status: 503, headers: NO_STORE });
  }
}

/**
 * Public API-prefixed health check endpoint.
 *
 * Proxies to the Python API's /health endpoint when
 * ATLAS_SERVER_API_PROXY_TARGET is configured. Returns 200 when all
 * services are reachable, 503 if the API is unreachable.
 *
 * Used by OpenStatus (atlasapp.openstatus.dev) to monitor service health.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: handleHealthGet,
    },
  },
});
