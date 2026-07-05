import { createFileRoute } from "@tanstack/react-router";
import { handleDeviceAuthAlias } from "@/domains/access/server/device-auth-alias";

export const Route = createFileRoute("/device/deny")({
  server: {
    handlers: {
      POST: async ({ request }) => handleDeviceAuthAlias(request, "deny"),
    },
  },
});
