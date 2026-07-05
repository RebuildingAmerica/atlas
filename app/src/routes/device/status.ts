import { createFileRoute } from "@tanstack/react-router";
import { handleDeviceAuthAlias } from "@/domains/access/server/device-auth-alias";

export const Route = createFileRoute("/device/status")({
  server: {
    handlers: {
      GET: async ({ request }) => handleDeviceAuthAlias(request, "status"),
    },
  },
});
