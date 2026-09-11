import "@tanstack/react-start/server-only";

import { getRequest, getRequestHeaders } from "@tanstack/react-start/server";
import { sanitizeBrowserSessionHeaders } from "./runtime";

/**
 * Returns the sanitized session headers for the current request context.
 *
 * This stays isolated in a server-only module so auth runtime config remains
 * safe to import from routes that participate in the client route tree.
 */
export function getBrowserSessionHeaders(): Headers {
  // getRequestHeaders() returns Headers at runtime but TanStack types it loosely

  return sanitizeBrowserSessionHeaders(getRequestHeaders());
}

/**
 * Returns the unsanitized request behind the current server function.
 *
 * Anything that has to see the forwarding chain or the request path needs
 * this. `getBrowserSessionHeaders` deliberately keeps only the cookie, so a
 * caller that reads `x-forwarded-for` from it gets nothing.
 */
export function getServerFnRequest(): Request {
  return getRequest();
}
