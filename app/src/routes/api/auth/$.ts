import { createFileRoute } from "@tanstack/react-router";
import { ensureAuthReady } from "@/domains/access/server/auth";

/**
 * First-party Better Auth route surface mounted under `/api/auth/*`.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return (await ensureAuthReady()).handler(request);
      },
      POST: async ({ request }) => {
        return (await ensureAuthReady()).handler(request);
      },
    },
  },
});
