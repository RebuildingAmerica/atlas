import { createFileRoute } from "@tanstack/react-router";
import { ensureAuthReady } from "@/domains/access/server/auth";
import { handleCimdRequest } from "@/domains/access/server/cimd-handler";
import { enforceOAuthTokenResourceConsistency } from "@/domains/access/server/oauth-token-resource-guard";
import { getCimdResolverOptions } from "@/domains/access/server/runtime";

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
