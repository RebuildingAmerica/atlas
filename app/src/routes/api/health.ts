import { createFileRoute } from "@tanstack/react-router";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Public health check endpoint.
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
      GET: async () => {
        const { apiBaseUrl } = getAuthRuntimeConfig();

        if (!apiBaseUrl) {
          return Response.json({ status: "ok" }, { headers: NO_STORE });
        }

        try {
          const apiResponse = await fetch(`${apiBaseUrl}/health`, {
            signal: AbortSignal.timeout(5000),
          });

          if (!apiResponse.ok) {
            return Response.json({ status: "degraded" }, { status: 503, headers: NO_STORE });
          }

          return Response.json({ status: "ok" }, { headers: NO_STORE });
        } catch {
          return Response.json({ status: "degraded" }, { status: 503, headers: NO_STORE });
        }
      },
    },
  },
});
