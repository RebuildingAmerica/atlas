import { createFileRoute } from "@tanstack/react-router";

async function loadPlatformWaitlistModule() {
  if (import.meta.env.SSR) {
    return await import("@/domains/waitlist/server/internal-platform-waitlist");
  }

  throw new Error("Platform lookups are only answered on the server.");
}

/**
 * Private callback the API uses to review paid-access requests for the
 * platform admin.
 */
export const Route = createFileRoute("/api/auth/internal/platform-waitlist")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handlePlatformWaitlistRequest } = await loadPlatformWaitlistModule();

        return handlePlatformWaitlistRequest(request);
      },
    },
  },
});
