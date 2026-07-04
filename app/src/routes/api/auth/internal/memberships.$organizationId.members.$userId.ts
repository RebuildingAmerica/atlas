import { createFileRoute } from "@tanstack/react-router";

async function loadInternalMembershipModule() {
  if (import.meta.env.SSR) {
    return await import("@/domains/access/server/internal-membership");
  }

  throw new Error("Internal membership verification is only available on the server.");
}

/**
 * Private membership verification route used by the API service.
 */
export const Route = createFileRoute(
  "/api/auth/internal/memberships/$organizationId/members/$userId",
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { verifyMembershipRequest } = await loadInternalMembershipModule();

        return verifyMembershipRequest(request, params.organizationId, params.userId);
      },
    },
  },
});
