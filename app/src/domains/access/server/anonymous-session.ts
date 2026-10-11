/** Only Cloudflare Access's cookie is unrelated to Atlas authentication. */
export function hasSessionCredentials(headers: Headers): boolean {
  if (headers.has("authorization")) return true;
  const cookies = headers.get("cookie");
  if (cookies === null) return false;
  // Access injects this even for service-token requests. Treat every other
  // cookie, including unknown or malformed input, as requiring authentication.
  return cookies.split(";").some((cookie) => !cookie.trim().startsWith("CF_Authorization="));
}

/**
 * An anonymous session read has no identity to look up. Keep public navigation
 * fast without constructing the auth backend, router, or database connection.
 * This shared response is used by both Node routes and the Workers entrypoint.
 */
export function anonymousSessionResponse(request: Request): Response | null {
  if (
    request.method !== "GET" ||
    new URL(request.url).pathname !== "/api/auth/get-session" ||
    hasSessionCredentials(request.headers)
  ) {
    return null;
  }
  return Response.json(null, { headers: { "cache-control": "private, no-store" } });
}
