import "@tanstack/react-start/server-only";

const HOSTED_E2E_UNAVAILABLE = { error: "Hosted E2E is unavailable." } as const;

/**
 * Checks whether a hosted E2E request may use the staging-only verification
 * helper surface. The helper must never be available by default or in
 * production because it creates synthetic account state for browser proof.
 *
 * @param request - Incoming helper request.
 * @param env - Environment to evaluate, injected by tests.
 */
export function assertHostedE2EAuthorized(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Response | null {
  const enabled = env.ATLAS_HOSTED_E2E_ENABLED === "1";
  const deployMode = env.ATLAS_DEPLOY_MODE?.trim();
  const vercelEnv = env.VERCEL_ENV?.trim();
  const expectedSecret = env.ATLAS_HOSTED_E2E_SECRET?.trim();
  const actualSecret = request.headers.get("x-atlas-hosted-e2e-secret")?.trim();

  if (
    !enabled ||
    deployMode === "production" ||
    vercelEnv === "production" ||
    !expectedSecret ||
    actualSecret !== expectedSecret
  ) {
    return Response.json(HOSTED_E2E_UNAVAILABLE, { status: 404 });
  }

  return null;
}
