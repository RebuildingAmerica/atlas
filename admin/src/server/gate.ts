/**
 * The admin's own gate, run before every page, server function and asset.
 *
 * Order matters and follows the org standard: refuse with 503 when the admin
 * is not configured, then verify the Access sign-in and the operator list,
 * then check the Origin of anything that changes data. A refused caller never
 * learns whether a path exists, and the reason is logged, never returned.
 */

import type { AdminRuntimeResult } from "./admin-runtime";
import { identifyOperator } from "./operator";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Headers on every refusal: never cached, framed, sniffed or indexed. */
export const REFUSAL_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Content-Type": "text/plain; charset=utf-8",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
};

/** Headers on every page the admin serves. */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
};

const NOT_CONFIGURED = "The Atlas platform admin is not configured.";
const REFUSED = "You do not have access to the Atlas platform admin.";

function refuse(status: 403 | 503, message: string): Response {
  return new Response(message, { status, headers: REFUSAL_HEADERS });
}

/**
 * Returns the refusal for a request that may not proceed, or null to let it through.
 *
 * @param request - The incoming request.
 * @param runtime - The admin's runtime, or the error that stopped it from building.
 */
export async function gateRequest(
  request: Request,
  runtime: AdminRuntimeResult,
): Promise<Response | null> {
  if (runtime instanceof Error) {
    console.error("Platform admin is not configured", {
      reason: runtime.message,
    });
    return refuse(503, NOT_CONFIGURED);
  }
  const operator = await identifyOperator(request, runtime);
  if (!operator.ok) {
    console.warn("Refused a platform admin request", {
      reason: operator.reason,
    });
    return refuse(403, REFUSED);
  }
  if (
    !SAFE_METHODS.has(request.method) &&
    request.headers.get("Origin") !== runtime.env.adminOrigin
  ) {
    console.warn("Refused a platform admin request", {
      reason: "cross_origin",
    });
    return refuse(403, REFUSED);
  }
  return null;
}

/**
 * Adds the admin's page headers to a response the gate let through.
 *
 * @param headers - The response's headers.
 */
export function applyPageHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(PAGE_HEADERS))
    headers.set(name, value);
}
