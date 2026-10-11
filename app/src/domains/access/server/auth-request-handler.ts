import { anonymousSessionResponse } from "@/domains/access/server/anonymous-session";

async function loadAuthRouteModules() {
  const [auth, cimdHandler, oauthGuard, runtime] = await Promise.all([
    import("@/domains/access/server/auth"),
    import("@/domains/access/server/cimd-handler"),
    import("@/domains/access/server/oauth-token-resource-guard"),
    import("@/domains/access/server/runtime"),
  ]);
  return { auth, cimdHandler, oauthGuard, runtime };
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
export async function dispatchAuthRequest(request: Request): Promise<Response> {
  if (!import.meta.env.SSR) {
    throw new Error("Auth route handling is only available on the server.");
  }
  const anonymous = anonymousSessionResponse(request);
  if (anonymous) return anonymous;
  const { auth: authModule, cimdHandler, oauthGuard, runtime } = await loadAuthRouteModules();
  if (new URL(request.url).pathname === "/api/auth/scout/token") {
    const scoutToken = await import("@/domains/access/server/scout-token");
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
