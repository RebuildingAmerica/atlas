import "@tanstack/react-start/server-only";

import { getRequestHeaders } from "@tanstack/react-start/server";
import { sanitizeBrowserSessionHeaders } from "./runtime";

/**
 * Returns the sanitized session headers for the current request context.
 *
 * This stays isolated in a server-only module so auth runtime config remains
 * safe to import from routes that participate in the client route tree.
 */
export function getBrowserSessionHeaders(): Headers {
  // getRequestHeaders() returns Headers at runtime but TanStack types it loosely
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return sanitizeBrowserSessionHeaders(getRequestHeaders());
}
