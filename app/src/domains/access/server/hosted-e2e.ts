import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canManageAtlasOrganizationRole } from "../organization-metadata";
import { requireActiveWorkspace } from "../organization-server-helpers";
import { ensureAuthReady, type AtlasAuthAdapter, type AtlasAuthInternalAdapter } from "./auth";
import { createAtprotoSessionForUser } from "./atproto-sign-in";
import { requireAtlasSessionState } from "./session-state";

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

interface HostedE2EPasskeySeed {
  aaguid: string;
  backedUp: boolean;
  counter: number;
  credentialID: string;
  deviceType: string;
  name: string;
  publicKey: string;
  transports: string;
}

interface HostedE2EUserLookup {
  user: {
    id: string;
  };
}

interface HostedE2ERecord {
  id: string;
}

function isHostedE2EUserLookup(value: unknown): value is HostedE2EUserLookup {
  return (
    typeof value === "object" &&
    value !== null &&
    "user" in value &&
    typeof value.user === "object" &&
    value.user !== null &&
    "id" in value.user &&
    typeof value.user.id === "string"
  );
}

function isHostedE2ERecord(value: unknown): value is HostedE2ERecord {
  return (
    typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
  );
}

function hostedE2EEmail(runId: string, role: HostedE2EAccountSeed["role"]): string {
  return `atlas-hosted-e2e+${runId}-${role}@atlas.test`;
}

function hostedE2EHandleSuffix(): string {
  const configuredPdsUrl = process.env.ATLAS_PDS_PUBLIC_URL?.trim();
  if (!configuredPdsUrl) return "atlas.test";

  try {
    return new URL(configuredPdsUrl).hostname.toLowerCase();
  } catch {
    throw new Error("ATLAS_PDS_PUBLIC_URL must be an absolute URL for hosted E2E handles.");
  }
}

function compactHostedE2ERunId(runId: string): string {
  return runId.replace(/[^a-z0-9]/g, "").slice(-12);
}

function hostedE2EHandle(runId: string, role: HostedE2EAccountSeed["role"]): string {
  const suffix = hostedE2EHandleSuffix();
  if (suffix === "atlas.test") {
    return `atlas-hosted-${runId}-${role}.${suffix}`;
  }
  const roleMarker = role === "delegate" ? "d" : "o";
  return `a${compactHostedE2ERunId(runId)}${roleMarker}.${suffix}`;
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
 * Builds the minimal Better Auth passkey model data needed for the hosted
 * ATProto sign-in gate to recognize a synthetic staging user as passkey-backed.
 *
 * @param input - Run and account role for the synthetic credential.
 */
export function buildHostedE2EPasskeySeed(input: {
  role: HostedE2EAccountSeed["role"];
  runId: string;
}): HostedE2EPasskeySeed {
  const runId = hostedE2ERunIdSchema.parse(input.runId.trim().toLowerCase());
  return {
    aaguid: "00000000-0000-0000-0000-000000000000",
    backedUp: false,
    counter: 0,
    credentialID: `atlas-hosted-e2e-${runId}-${input.role}`,
    deviceType: "singleDevice",
    name: "Hosted E2E passkey",
    publicKey: "atlas-hosted-e2e-public-key",
    transports: "internal",
  };
}

/**
 * Checks whether a hosted E2E request may use the protected verification helper
 * surface. The helper must never be available by default. Production requires a
 * second explicit gate because the route creates synthetic account state for
 * browser proof.
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
  const productionProofEnabled = env.ATLAS_HOSTED_E2E_PRODUCTION_ENABLED === "1";
  const expectedSecret = env.ATLAS_HOSTED_E2E_SECRET?.trim();
  const actualSecret = request.headers.get("x-atlas-hosted-e2e-secret")?.trim();
  const productionRuntime = deployMode === "production" || vercelEnv === "production";

  if (
    !enabled ||
    (productionRuntime && !productionProofEnabled) ||
    !expectedSecret ||
    actualSecret !== expectedSecret
  ) {
    return Response.json(HOSTED_E2E_UNAVAILABLE, { status: 404 });
  }

  return null;
}

async function upsertHostedE2EUser(
  internalAdapter: AtlasAuthInternalAdapter,
  seed: HostedE2EAccountSeed,
): Promise<string> {
  const existing = await internalAdapter.findUserByEmail(seed.email);
  if (isHostedE2EUserLookup(existing)) {
    await internalAdapter.updateUser(existing.user.id, {
      email: seed.email,
      emailVerified: true,
      name: seed.name,
    });
    return existing.user.id;
  }

  const userId = `hosted_e2e_user_${randomUUID()}`;
  await internalAdapter.createUser({
    email: seed.email,
    emailVerified: true,
    id: userId,
    image: null,
    name: seed.name,
  });
  return userId;
}

async function ensureHostedE2EPasskey(
  adapter: AtlasAuthAdapter,
  input: {
    role: HostedE2EAccountSeed["role"];
    runId: string;
    userId: string;
  },
): Promise<void> {
  const passkey = buildHostedE2EPasskeySeed(input);
  const existing = await adapter.findOne({
    model: "passkey",
    where: [{ field: "credentialID", value: passkey.credentialID }],
  });
  if (existing) {
    return;
  }

  await adapter.create({
    model: "passkey",
    data: {
      ...passkey,
      createdAt: new Date(),
      userId: input.userId,
    },
  });
}

async function findHostedE2EUserId(
  internalAdapter: AtlasAuthInternalAdapter,
  email: string,
): Promise<string> {
  const existing = await internalAdapter.findUserByEmail(email.trim().toLowerCase());
  if (!isHostedE2EUserLookup(existing)) {
    throw new Error("Hosted E2E account is unavailable.");
  }
  return existing.user.id;
}

async function upsertHostedE2EMembership(
  adapter: AtlasAuthAdapter,
  input: {
    organizationId: string;
    userId: string;
  },
): Promise<void> {
  const existingMember = await adapter.findOne({
    model: "member",
    where: [
      { field: "organizationId", value: input.organizationId },
      { field: "userId", value: input.userId },
    ],
  });
  if (existingMember) {
    if (!isHostedE2ERecord(existingMember)) {
      throw new Error("Hosted E2E member lookup did not return a member id.");
    }
    await adapter.update({
      model: "member",
      update: { role: "member" },
      where: [{ field: "id", value: existingMember.id }],
    });
    return;
  }

  await adapter.create({
    forceAllowId: true,
    model: "member",
    data: {
      createdAt: new Date(),
      id: `hosted_e2e_member_${randomUUID()}`,
      organizationId: input.organizationId,
      role: "member",
      userId: input.userId,
    },
  });
}

async function prepareHostedE2ERun(runId: string): Promise<Response> {
  const seeds = buildHostedE2EAccountSeeds(runId);
  const auth = await ensureAuthReady();
  const context = await auth.$context;
  const ownerUserId = await upsertHostedE2EUser(context.internalAdapter, seeds.owner);
  const delegateUserId = await upsertHostedE2EUser(context.internalAdapter, seeds.delegate);
  await Promise.all([
    ensureHostedE2EPasskey(context.adapter, {
      role: "owner",
      runId: seeds.runId,
      userId: ownerUserId,
    }),
    ensureHostedE2EPasskey(context.adapter, {
      role: "delegate",
      runId: seeds.runId,
      userId: delegateUserId,
    }),
  ]);

  return Response.json({
    delegate: { ...seeds.delegate, userId: delegateUserId },
    owner: { ...seeds.owner, userId: ownerUserId },
    runId: seeds.runId,
  });
}

async function createHostedE2ESession(runId: string, email: string): Promise<Response> {
  const seeds = buildHostedE2EAccountSeeds(runId);
  const allowedEmails = new Set([seeds.owner.email, seeds.delegate.email]);
  const normalizedEmail = email.trim().toLowerCase();
  if (!allowedEmails.has(normalizedEmail)) {
    return Response.json({ error: "Hosted E2E account is unavailable." }, { status: 404 });
  }

  const auth = await ensureAuthReady();
  const context = await auth.$context;
  const userId = await findHostedE2EUserId(context.internalAdapter, normalizedEmail);
  return await createAtprotoSessionForUser(userId);
}

async function seedHostedE2EWorkspaceMember(
  runId: string,
  delegateEmail: string,
): Promise<Response> {
  const seeds = buildHostedE2EAccountSeeds(runId);
  if (delegateEmail.trim().toLowerCase() !== seeds.delegate.email) {
    return Response.json({ error: "Hosted E2E member is unavailable." }, { status: 404 });
  }

  const session = await requireAtlasSessionState();
  const activeWorkspace = requireActiveWorkspace(session);
  if (!canManageAtlasOrganizationRole(activeWorkspace.role)) {
    return Response.json({ error: "Hosted E2E member is unavailable." }, { status: 404 });
  }

  const auth = await ensureAuthReady();
  const context = await auth.$context;
  const userId = await findHostedE2EUserId(context.internalAdapter, seeds.delegate.email);
  await upsertHostedE2EMembership(context.adapter, {
    organizationId: activeWorkspace.id,
    userId,
  });

  return Response.json({
    email: seeds.delegate.email,
    name: seeds.delegate.name,
    userId,
  });
}

/**
 * Handles the protected hosted identity verification helper route.
 *
 * @param request - Incoming helper request.
 */
export async function handleHostedE2EIdentityRequest(request: Request): Promise<Response> {
  const unauthorized = assertHostedE2EAuthorized(request);
  if (unauthorized) return unauthorized;

  const payload = hostedE2EPayloadSchema.parse(await request.json());
  if (payload.action === "prepare") {
    return await prepareHostedE2ERun(payload.runId);
  }
  if (payload.action === "session") {
    return await createHostedE2ESession(payload.runId, payload.email);
  }
  if (payload.action === "member") {
    return await seedHostedE2EWorkspaceMember(payload.runId, payload.delegateEmail);
  }

  return Response.json({ ok: true, runId: payload.runId });
}
