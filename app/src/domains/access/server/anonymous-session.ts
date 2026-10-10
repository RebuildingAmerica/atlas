/** Any supplied cookie or authorization header must go through real authentication. */
export function hasSessionCredentials(headers: Headers): boolean {
  return headers.has("cookie") || headers.has("authorization");
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
