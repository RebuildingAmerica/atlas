import { createFileRoute } from "@tanstack/react-router";
import { dispatchAuthRequest } from "@/domains/access/server/auth-request-handler";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => dispatchAuthRequest(request),
      POST: async ({ request }) => dispatchAuthRequest(request),
    },
  },
});
