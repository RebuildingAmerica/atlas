import { createFileRoute } from "@tanstack/react-router";

/**
 * Private API-key introspection route used by the backend API service.
 */
export const Route = createFileRoute("/api/auth/internal/api-key")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { introspectApiKeyRequest } =
          await import("@/domains/access/server/internal-api-key");

        return introspectApiKeyRequest(request);
      },
    },
  },
});
