import "@tanstack/react-start/server-only";

import { z } from "zod";

const HOSTED_E2E_UNAVAILABLE = { error: "Hosted E2E is unavailable." } as const;
const hostedE2ERunIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export const hostedE2EPayloadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("prepare"),
    runId: hostedE2ERunIdSchema,
  }),
  z.object({
    action: z.literal("session"),
    email: z.string().email(),
    runId: hostedE2ERunIdSchema,
  }),
  z.object({
    action: z.literal("member"),
    delegateEmail: z.string().email(),
    runId: hostedE2ERunIdSchema,
  }),
  z.object({
    action: z.literal("cleanup"),
    runId: hostedE2ERunIdSchema,
  }),
]);

interface HostedE2EAccountSeed {
  email: string;
  handle: string;
  name: string;
  role: "delegate" | "owner";
}

interface HostedE2EAccountSeeds {
  delegate: HostedE2EAccountSeed;
  owner: HostedE2EAccountSeed;
  runId: string;
}

function hostedE2EEmail(runId: string, role: HostedE2EAccountSeed["role"]): string {
  return `atlas-hosted-e2e+${runId}-${role}@atlas.test`;
}

function hostedE2EHandle(runId: string, role: HostedE2EAccountSeed["role"]): string {
  return `atlas-hosted-${runId}-${role}.atlas.test`;
}

/**
 * Builds deterministic, run-scoped hosted E2E account identities.
 *
 * @param runId - GitHub run id plus attempt, already validated by the payload schema.
 */
export function buildHostedE2EAccountSeeds(runId: string): HostedE2EAccountSeeds {
  const normalizedRunId = hostedE2ERunIdSchema.parse(runId.trim().toLowerCase());
  return {
    delegate: {
      email: hostedE2EEmail(normalizedRunId, "delegate"),
      handle: hostedE2EHandle(normalizedRunId, "delegate"),
      name: `Hosted E2E Delegate ${normalizedRunId}`,
      role: "delegate",
    },
    owner: {
      email: hostedE2EEmail(normalizedRunId, "owner"),
      handle: hostedE2EHandle(normalizedRunId, "owner"),
      name: `Hosted E2E Owner ${normalizedRunId}`,
      role: "owner",
    },
    runId: normalizedRunId,
  };
}

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
