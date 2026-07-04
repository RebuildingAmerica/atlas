import { createFileRoute } from "@tanstack/react-router";

async function loadAuthRouteModules() {
  if (import.meta.env.SSR) {
    const [auth, cimdHandler, oauthGuard, runtime] = await Promise.all([
      import("@/domains/access/server/auth"),
      import("@/domains/access/server/cimd-handler"),
      import("@/domains/access/server/oauth-token-resource-guard"),
      import("@/domains/access/server/runtime"),
    ]);
    return { auth, cimdHandler, oauthGuard, runtime };
  }

  throw new Error("Auth route handling is only available on the server.");
}

/**
 * First-party Better Auth route surface mounted under `/api/auth/*`.
 *
 * The route runs the Atlas-side Client ID Metadata Documents shim before
 * delegating to Better Auth so URL-shaped `client_id` values resolve into
 * synthetic `oauthClient` rows.  This unblocks the spec's "no prior
 * relationship" onboarding flow without re-enabling Better Auth's
 * unauthenticated dynamic client registration phishing surface.
 */
async function dispatch(request: Request): Promise<Response> {
  const { auth: authModule, cimdHandler, oauthGuard, runtime } = await loadAuthRouteModules();
  const scoutToken = await import("@/domains/access/server/scout-token");
  if (new URL(request.url).pathname === "/api/auth/scout/token") {
    return scoutToken.issueScoutTokenRequest(request);
  }
  const { ensureAuthReady } = authModule;
  const { handleCimdRequest } = cimdHandler;
  const { enforceOAuthTokenResourceConsistency } = oauthGuard;
  const { getCimdResolverOptions } = runtime;
  const outcome = await handleCimdRequest(request, getCimdResolverOptions());
  if (outcome.errorResponse) {
    return outcome.errorResponse;
  }
  const auth = await ensureAuthReady();
  const resourceGuardResponse = await enforceOAuthTokenResourceConsistency(outcome.request, auth);
  if (resourceGuardResponse) {
    return resourceGuardResponse;
  }
  return auth.handler(outcome.request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => dispatch(request),
      POST: async ({ request }) => dispatch(request),
    },
  },
});
