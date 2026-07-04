import { createFileRoute } from "@tanstack/react-router";

async function loadInternalApiKeyModule() {
  if (import.meta.env.SSR) {
    return await import("@/domains/access/server/internal-api-key");
  }

  throw new Error("Internal API-key introspection is only available on the server.");
}

/**
 * Private API-key introspection route used by the API service.
 */
export const Route = createFileRoute("/api/auth/internal/api-key")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { introspectApiKeyRequest } = await loadInternalApiKeyModule();

        return introspectApiKeyRequest(request);
      },
    },
  },
});
