import { createFileRoute } from "@tanstack/react-router";

import { handleHealthGet } from "./api/health";

/**
 * Public health check endpoint at the documented production URL.
 */
export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: handleHealthGet,
    },
  },
});
