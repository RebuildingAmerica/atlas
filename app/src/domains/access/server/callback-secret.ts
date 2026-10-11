import "@tanstack/react-start/server-only";

import { timingSafeEqual } from "node:crypto";

/** Header the Atlas API sends when it calls back into the app. */
export const CALLBACK_SECRET_HEADER = "x-atlas-callback-secret"; // pragma: allowlist secret - a header name

/**
 * Returns whether a request from the Atlas API carries the callback secret.
 *
 * Membership checks and API-key introspection are the only app endpoints the
 * API calls. They accept this secret and nothing else; the app's own signing
 * secret never leaves the app.
 *
 * @param request - The incoming callback request.
 * @param callbackSecret - The configured `ATLAS_AUTH_CALLBACK_SECRET`.
 */
export function hasCallbackSecret(request: Request, callbackSecret: string): boolean {
  const providedSecret = request.headers.get(CALLBACK_SECRET_HEADER);
  return (
    !!callbackSecret &&
    !!providedSecret &&
    callbackSecret.length === providedSecret.length &&
    timingSafeEqual(Buffer.from(callbackSecret), Buffer.from(providedSecret))
  );
}
