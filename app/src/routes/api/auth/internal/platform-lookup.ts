import { createFileRoute } from "@tanstack/react-router";

async function loadPlatformLookupModule() {
  if (import.meta.env.SSR) {
    return await import("@/domains/billing/server/internal-platform-lookup");
  }

  throw new Error("Platform lookups are only answered on the server.");
}

/**
 * Private callback the API uses to look up an account or workspace for the
 * platform admin.
 */
export const Route = createFileRoute("/api/auth/internal/platform-lookup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handlePlatformLookupRequest } = await loadPlatformLookupModule();

        return handlePlatformLookupRequest(request);
      },
    },
  },
});
