import { createFileRoute } from "@tanstack/react-router";

/**
 * Private membership verification route used by the API service.
 */
export const Route = createFileRoute(
  "/api/auth/internal/memberships/$organizationId/members/$userId",
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { verifyMembershipRequest } =
          await import("@/domains/access/server/internal-membership");

        return verifyMembershipRequest(request, params.organizationId, params.userId);
      },
    },
  },
});
