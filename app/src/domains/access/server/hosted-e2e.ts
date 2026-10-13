import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { canManageAtlasOrganizationRole } from "@rebuildingamerica/atlas-access/workspace/organization-metadata";
import { requireActiveWorkspace } from "../organization-server-helpers";
import {
  ensureAuthReady,
  getAuthPgPool,
  type AtlasAuthAdapter,
  type AtlasAuthInternalAdapter,
} from "./auth";
import { createAtprotoSessionForUser } from "./atproto-sign-in";
import { requireAtlasSessionState } from "./session-state";

const HOSTED_E2E_UNAVAILABLE = { error: "Hosted E2E is unavailable." } as const;
const hostedE2ERunIdSchema = z.string().regex(/^\d{1,11}-[1-9]\d?$/);

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
function isPublicOrigin(value: string | undefined): boolean {
  const candidate = value?.trim();
  if (!candidate) {
    return false;
  }
  try {
    const { hostname } = new URL(candidate);
    return hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1";
  } catch {
    return false;
  }
}

export function assertHostedE2EAuthorized(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Response | null {
  const enabled = env.ATLAS_HOSTED_E2E_ENABLED === "1";
  const vercelEnv = env.VERCEL_ENV?.trim();
  const productionProofEnabled = env.ATLAS_HOSTED_E2E_PRODUCTION_ENABLED === "1";
  const expectedSecret = env.ATLAS_HOSTED_E2E_SECRET?.trim();
  const actualSecret = request.headers.get("x-atlas-hosted-e2e-secret")?.trim();
  // A deployment serving a public origin needs the second gate, whoever runs
  // it. Keyed on the URL rather than a declared mode so a self-hosted instance
  // cannot leave the synthetic-account route open by simply not naming itself.
  const productionRuntime = vercelEnv === "production" || isPublicOrigin(env.ATLAS_PUBLIC_URL);

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

/**
 * Decides whether one ATProto sign-in start may use the synthetic provider.
 * Public runtimes must pass the protected hosted-E2E guard even when a global
 * harness flag was accidentally configured. Local test runtimes keep the
 * explicit harness flag used by the acceptance suite.
 *
 * @param request - Incoming ATProto sign-in start request.
 * @param env - Environment to evaluate, injected by tests.
 */
export function isAtprotoSignInHarnessAuthorized(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const publicRuntime =
    env.VERCEL_ENV?.trim() === "production" || isPublicOrigin(env.ATLAS_PUBLIC_URL);
  if (!publicRuntime) {
    return env.ATLAS_ATPROTO_OAUTH_E2E_HARNESS === "1";
  }
  return assertHostedE2EAuthorized(request, env) === null;
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
  try {
    await assertHostedE2ECleanupAvailable();
  } catch {
    return Response.json({ error: "Hosted E2E cleanup is unavailable." }, { status: 503 });
  }
  try {
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
  } catch {
    try {
      await cleanupHostedE2ERun(seeds);
    } catch {
      return Response.json(
        { error: "Hosted E2E preparation and cleanup could not be verified." },
        { status: 503 },
      );
    }
    return Response.json(
      { error: "Hosted E2E preparation failed; temporary accounts were removed." },
      { status: 503 },
    );
  }
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

  try {
    return await cleanupHostedE2ERun(buildHostedE2EAccountSeeds(payload.runId));
  } catch {
    return Response.json({ error: "Hosted E2E cleanup could not be verified." }, { status: 503 });
  }
}

interface FixtureUser {
  id: string;
  email: string;
  name: string;
}
interface FixtureWorkspace {
  id: string;
  name: string;
}
interface FixtureIdentity {
  id: string;
  did: string;
  current_handle: string;
  pds_url: string;
}
interface PdsFixture {
  handle: string;
  email: string;
  did?: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function brokerSettings() {
  const url = new URL(process.env.ATLAS_PDS_INVITE_BROKER_URL ?? "");
  const pds = new URL(process.env.ATLAS_PDS_PUBLIC_URL ?? "");
  const secret = process.env.ATLAS_PDS_INVITE_BROKER_SECRET?.trim();
  if (
    !secret ||
    url.protocol !== "https:" ||
    url.origin !== pds.origin ||
    url.pathname !== "/_atlas/pds/invites" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Hosted E2E cleanup is unavailable.");
  return { url, secret, pds: pds.origin };
}

async function brokerRequest(body?: {
  action: "cleanup-hosted-e2e";
  runId: string;
  accounts: PdsFixture[];
}) {
  let settings: ReturnType<typeof brokerSettings>;
  try {
    settings = brokerSettings();
  } catch {
    console.error(JSON.stringify({ hostedCleanup: { stage: "broker-configuration" } }));
    throw new Error("Hosted E2E cleanup is unavailable.");
  }
  const { url, secret } = settings;
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      // Workers supports manual redirects; the non-2xx guard below rejects them
      // without forwarding the broker credential to another origin.
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    console.error(JSON.stringify({ hostedCleanup: { stage: "broker-transport" } }));
    throw new Error("Hosted E2E cleanup is unavailable.");
  }
  if (!response.ok) {
    console.error(
      JSON.stringify({ hostedCleanup: { stage: "broker-response", httpStatus: response.status } }),
    );
    throw new Error("Hosted E2E cleanup is unavailable.");
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    console.error(JSON.stringify({ hostedCleanup: { stage: "broker-json" } }));
    throw new Error("Hosted E2E cleanup is unavailable.");
  }
}

/** Refuse fixture creation until the existing PDS broker can delete this run's accounts. */
export async function assertHostedE2ECleanupAvailable(): Promise<void> {
  const result = await brokerRequest();
  if (
    typeof result !== "object" ||
    result === null ||
    !("hostedFixtureCleanup" in result) ||
    result.hostedFixtureCleanup !== true
  )
    throw new Error("Hosted E2E cleanup is unavailable.");
}

function fixturePdsEmail(user: FixtureUser, handle: string): string {
  const local = user.email.slice(0, user.email.lastIndexOf("@")).slice(0, 40);
  const digest = createHash("sha256").update(`${user.id}:${handle}`).digest("hex").slice(0, 16);
  return `${local}+atlas-${digest}@atlas.test`;
}

/** Delete only exact-run fixtures; retain everything if ownership or provider deletion is unproven. */
export async function cleanupHostedE2ERun(seeds: HostedE2EAccountSeeds): Promise<Response> {
  await assertHostedE2ECleanupAvailable();
  await ensureAuthReady();
  const pool = getAuthPgPool();
  if (!pool) throw new Error("Hosted E2E cleanup requires PostgreSQL.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const { rows: users } = await client.query<FixtureUser>(
      'SELECT id, email, name FROM "user" WHERE email = ANY($1::text[]) FOR UPDATE',
      [[seeds.owner.email, seeds.delegate.email]],
    );
    for (const user of users) {
      const seed = user.email === seeds.owner.email ? seeds.owner : seeds.delegate;
      if (!user.id.startsWith("hosted_e2e_user_") || user.name !== seed.name)
        throw new Error("Hosted E2E cleanup ownership differs.");
    }
    const ids = users.map((user) => user.id);
    const { rows: workspaces } = await client.query<FixtureWorkspace>(
      'SELECT id, name FROM "organization" WHERE id IN (SELECT "organizationId" FROM "member" WHERE "userId" = ANY($1::text[])) FOR UPDATE',
      [ids],
    );
    if (
      workspaces.some(
        (workspace) => !users.some((user) => workspace.name === `${user.name}'s Workspace`),
      )
    )
      throw new Error("Hosted E2E workspace ownership differs.");
    const orgIds = workspaces.map((workspace) => workspace.id);
    const { rows: foreignMembers } = await client.query(
      'SELECT id FROM "member" WHERE "organizationId" = ANY($1::text[]) AND NOT ("userId" = ANY($2::text[])) LIMIT 1',
      [orgIds, ids],
    );
    const { rows: invitations } = await client.query(
      'SELECT id FROM "invitation" WHERE "organizationId" = ANY($1::text[]) LIMIT 1',
      [orgIds],
    );
    const { rows: purchases } = await client.query(
      "SELECT id FROM purchase_intents WHERE user_id = ANY($1::text[]) OR workspace_id = ANY($2::text[]) LIMIT 1",
      [ids, orgIds],
    );
    const { rows: billed } = await client.query(
      "SELECT id FROM workspace_products WHERE workspace_id = ANY($1::text[]) AND (stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL) LIMIT 1",
      [orgIds],
    );
    if (foreignMembers.length || invitations.length || purchases.length || billed.length)
      throw new Error("Hosted E2E workspace has non-fixture activity.");
    const compact = seeds.runId.replaceAll("-", "").slice(-12);
    const suffix = new URL(brokerSettings().pds).hostname;
    const organizationHandle = `a${compact}g.${suffix}`;
    const handles = [seeds.owner.handle, seeds.delegate.handle, organizationHandle];
    const { rows: identities } = await client.query<FixtureIdentity>(
      "SELECT id, did, current_handle, pds_url FROM atproto_identities WHERE current_handle = ANY($1::text[]) FOR UPDATE",
      [handles],
    );
    if (
      identities.some((identity) => identity.pds_url?.replace(/\/$/, "") !== brokerSettings().pds)
    )
      throw new Error("Hosted E2E identity provider differs.");
    if (
      identities.some(
        (identity) =>
          !users.some(
            (user) =>
              user.email ===
              (identity.current_handle === seeds.delegate.handle
                ? seeds.delegate.email
                : seeds.owner.email),
          ),
      )
    )
      throw new Error("Hosted E2E identity owner is unavailable.");
    const identityIds = identities.map((identity) => identity.id);
    const { rows: outsideLinks } = await client.query(
      `SELECT id FROM user_atproto_controls WHERE identity_id = ANY($1::text[]) AND NOT (user_id = ANY($2::text[]))
       UNION ALL SELECT id FROM profile_atproto_links WHERE identity_id = ANY($1::text[])
       UNION ALL SELECT id FROM organization_atproto_identities WHERE identity_id = ANY($1::text[]) AND NOT (organization_id = ANY($3::text[]))
       UNION ALL SELECT id FROM atproto_identity_delegations WHERE identity_id = ANY($1::text[]) AND (NOT (controller_user_id = ANY($2::text[])) OR NOT (delegate_user_id = ANY($2::text[])) OR NOT (organization_id = ANY($3::text[])))
       UNION ALL SELECT id FROM user_atproto_controls WHERE user_id = ANY($2::text[]) AND NOT (identity_id = ANY($1::text[]))
       UNION ALL SELECT id FROM organization_atproto_identities WHERE organization_id = ANY($3::text[]) AND NOT (identity_id = ANY($1::text[]))`,
      [identityIds, ids, orgIds],
    );
    if (outsideLinks.length) throw new Error("Hosted E2E identity has non-fixture links.");
    const accounts: PdsFixture[] = [];
    for (const user of users) {
      const userHandles =
        user.email === seeds.owner.email
          ? [seeds.owner.handle, organizationHandle]
          : [seeds.delegate.handle];
      for (const handle of userHandles) {
        const identity = identities.find((candidate) => candidate.current_handle === handle);
        accounts.push({
          handle,
          email: fixturePdsEmail(user, handle),
          ...(identity ? { did: identity.did } : {}),
        });
      }
    }
    const result = await brokerRequest({
      action: "cleanup-hosted-e2e",
      runId: seeds.runId,
      accounts,
    });
    if (
      typeof result !== "object" ||
      result === null ||
      !("cleanedHandles" in result) ||
      !isStringArray(result.cleanedHandles) ||
      JSON.stringify([...result.cleanedHandles].sort()) !==
        JSON.stringify(accounts.map((account) => account.handle).sort())
    )
      throw new Error("Hosted E2E PDS cleanup is unverified.");
    const dids = identities.map((identity) => identity.did);
    await client.query("DELETE FROM atproto_oauth_session WHERE key = ANY($1::text[])", [dids]);
    await client.query(
      `DELETE FROM atproto_oauth_state WHERE value->>'appState' IN
      (SELECT key FROM atproto_oauth_app_state WHERE value->>'userId' = ANY($1::text[]) OR value->>'requestedHandle' = ANY($2::text[]))`,
      [ids, handles],
    );
    await client.query(
      `DELETE FROM atproto_oauth_app_state WHERE value->>'userId' = ANY($1::text[]) OR value->>'requestedHandle' = ANY($2::text[])`,
      [ids, handles],
    );
    await client.query("DELETE FROM atproto_identities WHERE id = ANY($1::text[])", [identityIds]);
    await client.query("DELETE FROM workspace_products WHERE workspace_id = ANY($1::text[])", [
      orgIds,
    ]);
    await client.query('DELETE FROM "organization" WHERE id = ANY($1::text[])', [orgIds]);
    await client.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [ids]);
    const { rows: remaining } = await client.query(
      `SELECT id FROM "user" WHERE id = ANY($1::text[])
       UNION ALL SELECT id FROM "organization" WHERE id = ANY($2::text[])
       UNION ALL SELECT id FROM atproto_identities WHERE id = ANY($3::text[])
       UNION ALL SELECT id FROM "session" WHERE "userId" = ANY($1::text[])
       UNION ALL SELECT id FROM "account" WHERE "userId" = ANY($1::text[])
       UNION ALL SELECT id FROM "passkey" WHERE "userId" = ANY($1::text[])
       UNION ALL SELECT id FROM "member" WHERE "userId" = ANY($1::text[]) OR "organizationId" = ANY($2::text[])
       UNION ALL SELECT id FROM workspace_products WHERE workspace_id = ANY($2::text[])
       UNION ALL SELECT id FROM user_atproto_controls WHERE user_id = ANY($1::text[]) OR identity_id = ANY($3::text[])
       UNION ALL SELECT id FROM organization_atproto_identities WHERE organization_id = ANY($2::text[]) OR identity_id = ANY($3::text[])
       UNION ALL SELECT id FROM atproto_identity_delegations WHERE controller_user_id = ANY($1::text[]) OR delegate_user_id = ANY($1::text[]) OR identity_id = ANY($3::text[])
       UNION ALL SELECT key AS id FROM atproto_oauth_session WHERE key = ANY($4::text[])
       UNION ALL SELECT key AS id FROM atproto_oauth_app_state WHERE value->>'userId' = ANY($1::text[]) OR value->>'requestedHandle' = ANY($5::text[])`,
      [ids, orgIds, identityIds, dids, handles],
    );
    if (remaining.length) throw new Error("Hosted E2E cleanup is unverified.");
    await client.query("COMMIT");
    return Response.json({
      ok: true,
      runId: seeds.runId,
      deleted: {
        users: users.length,
        workspaces: workspaces.length,
        identities: identities.length,
      },
    });
  } catch {
    await client.query("ROLLBACK");
    throw new Error("Hosted E2E cleanup could not be verified.");
  } finally {
    client.release();
  }
}
