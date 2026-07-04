import "@tanstack/react-start/server-only";

import type { AtlasProduct } from "../capabilities";
import { mergeAtlasOrganizationMetadata } from "../organization-metadata";
import { ensureAuthReady } from "./auth";
import { grantWorkspaceProduct } from "./workspace-products";

export interface CustomerWorkspaceIdentityInput {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  userEmail: string;
  userId: string;
  userName: string;
}

export type BriefingRoomDemoWorkspaceInput = CustomerWorkspaceIdentityInput;

interface BriefingRoomDemoWorkspaceResult {
  organizationId: string;
  product: AtlasProduct;
  userId: string;
}

export type CustomerWorkspaceDemoDataSeed = "briefing_room" | "none";

export interface CustomerWorkspaceProvisionInput extends CustomerWorkspaceIdentityInput {
  demoDataSeed: CustomerWorkspaceDemoDataSeed;
  firstSavedViews: readonly string[];
  product: AtlasProduct;
}

export interface CustomerWorkspaceProvisionResult {
  demoDataSeed: CustomerWorkspaceDemoDataSeed;
  firstSavedViews: string[];
  organizationId: string;
  product: AtlasProduct;
  seedCommand: string | null;
  userId: string;
}

interface CustomerWorkspaceOnboardingMetadata {
  demoDataSeed: CustomerWorkspaceDemoDataSeed;
  firstSavedViews: string[];
  product: AtlasProduct;
  provisionedAt: string;
}

interface CustomerWorkspaceOrganizationMetadata {
  [metadataKey: string]: unknown;
  onboarding: CustomerWorkspaceOnboardingMetadata;
  workspaceType: "team";
}

type ReadyAuth = Awaited<ReturnType<typeof ensureAuthReady>>;
type BetterAuthContext = Awaited<ReadyAuth["$context"]>;
type BetterAuthAdapter = BetterAuthContext["adapter"];
type BetterAuthInternalAdapter = BetterAuthContext["internalAdapter"];

interface MemberRecord {
  id: string;
}

interface OrganizationMetadataRecord {
  metadata?: unknown;
}

const DEMO_PRODUCT: AtlasProduct = "atlas_team";
const DEMO_MEMBER_ROLE = "owner";
const DEMO_DATA_SEED: CustomerWorkspaceDemoDataSeed = "briefing_room";
const SAFE_WORKSPACE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const BRIEFING_ROOM_FIRST_SAVED_VIEWS: readonly string[] = [
  "Detroit mutual aid follow-up",
  "Atlanta housing follow-up",
  "Milwaukee democracy follow-up",
];

/**
 * Builds the organization metadata that makes a provisioned customer workspace
 * legible to operators during handoff.
 *
 * @param input - Customer workspace provisioning details.
 * @param provisionedAt - Timestamp for the provisioning pass.
 */
function customerWorkspaceMetadata(
  input: CustomerWorkspaceProvisionInput,
  provisionedAt: Date,
): CustomerWorkspaceOrganizationMetadata {
  return {
    onboarding: {
      demoDataSeed: input.demoDataSeed,
      firstSavedViews: [...input.firstSavedViews],
      product: input.product,
      provisionedAt: provisionedAt.toISOString(),
    },
    workspaceType: "team",
  };
}

/**
 * Builds the API seed command associated with a provisioned demo workspace.
 *
 * @param input - Customer workspace provisioning details.
 */
function demoDataSeedCommand(input: CustomerWorkspaceProvisionInput): string | null {
  if (input.demoDataSeed === "none") {
    return null;
  }

  return (
    "uv --directory ./api run python -m atlas.seed_briefing_room_demo " +
    `--org-id ${input.organizationId} --user-id ${input.userId}`
  );
}

/**
 * Rejects identifiers before Atlas prints or runs a shell seed command.
 *
 * @param value - Identifier used in the workspace seed handoff.
 * @param label - Human-readable field label for the error message.
 */
function assertSafeWorkspaceIdentifier(value: string, label: string): void {
  if (!SAFE_WORKSPACE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} may only contain letters, numbers, underscores, and hyphens.`);
  }
}

/**
 * Validates seed-command identifiers before any workspace records are changed.
 *
 * @param input - Customer workspace provisioning details.
 */
function validateCustomerWorkspaceProvisionInput(input: CustomerWorkspaceProvisionInput): void {
  assertSafeWorkspaceIdentifier(input.organizationId, "Organization id");
  assertSafeWorkspaceIdentifier(input.userId, "User id");
}

/**
 * Normalizes an operator email before provisioning or conflict checks.
 *
 * @param email - Operator email supplied by the staging command.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Builds the stable Better Auth member id for the seeded demo owner.
 *
 * @param organizationId - Better Auth organization id.
 * @param userId - Better Auth user id.
 */
function demoMemberId(organizationId: string, userId: string): string {
  return `member_${organizationId}_${userId}`;
}

/**
 * Narrows Better Auth's generic adapter lookup result to the member fields
 * Atlas needs before issuing an update.
 *
 * @param value - Adapter lookup result.
 */
function isMemberRecord(value: unknown): value is MemberRecord {
  return (
    typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
  );
}

/**
 * Narrows Better Auth's organization lookup result to the metadata field Atlas
 * may need to preserve during an idempotent provisioning refresh.
 *
 * @param value - Adapter lookup result.
 */
function isOrganizationMetadataRecord(value: unknown): value is OrganizationMetadataRecord {
  return typeof value === "object" && value !== null && "metadata" in value;
}

/**
 * Creates or refreshes the user who signs into the hosted Briefing Room demo.
 *
 * @param internalAdapter - Better Auth internal adapter.
 * @param input - Demo workspace identity.
 */
async function upsertDemoUser(
  internalAdapter: BetterAuthInternalAdapter,
  input: CustomerWorkspaceIdentityInput,
): Promise<void> {
  const email = normalizeEmail(input.userEmail);
  const existingUser = await internalAdapter.findUserById(input.userId);

  if (existingUser) {
    await internalAdapter.updateUser(input.userId, {
      email,
      emailVerified: true,
      name: input.userName,
    });
    return;
  }

  const existingByEmail = await internalAdapter.findUserByEmail(email);
  if (existingByEmail && existingByEmail.user.id !== input.userId) {
    throw new Error("Demo email already belongs to another Atlas user.");
  }

  if (existingByEmail) {
    await internalAdapter.updateUser(input.userId, {
      email,
      emailVerified: true,
      name: input.userName,
    });
    return;
  }

  await internalAdapter.createUser({
    email,
    emailVerified: true,
    id: input.userId,
    image: null,
    name: input.userName,
  });
}

/**
 * Creates or refreshes the team workspace that owns the hosted demo brief.
 *
 * @param adapter - Better Auth adapter.
 * @param input - Demo workspace identity.
 */
async function upsertDemoOrganization(
  adapter: BetterAuthAdapter,
  input: CustomerWorkspaceProvisionInput,
  provisionedAt: Date,
): Promise<void> {
  const metadata = customerWorkspaceMetadata(input, provisionedAt);
  const existingOrganization = await adapter.findOne({
    model: "organization",
    where: [{ field: "id", value: input.organizationId }],
  });

  if (existingOrganization) {
    const metadataJson =
      isOrganizationMetadataRecord(existingOrganization) &&
      existingOrganization.metadata !== undefined
        ? JSON.stringify(mergeAtlasOrganizationMetadata(existingOrganization.metadata, metadata))
        : JSON.stringify(metadata);
    await adapter.update({
      model: "organization",
      update: {
        logo: null,
        metadata: metadataJson,
        name: input.organizationName,
        slug: input.organizationSlug,
      },
      where: [{ field: "id", value: input.organizationId }],
    });
    return;
  }

  await adapter.create({
    forceAllowId: true,
    model: "organization",
    data: {
      createdAt: provisionedAt,
      id: input.organizationId,
      logo: null,
      metadata: JSON.stringify(metadata),
      name: input.organizationName,
      slug: input.organizationSlug,
    },
  });
}

/**
 * Creates or refreshes the owner membership for the hosted demo user.
 *
 * @param adapter - Better Auth adapter.
 * @param input - Demo workspace identity.
 */
async function upsertDemoMembership(
  adapter: BetterAuthAdapter,
  input: CustomerWorkspaceIdentityInput,
): Promise<void> {
  const memberId = demoMemberId(input.organizationId, input.userId);
  const existingMember = await adapter.findOne({
    model: "member",
    where: [
      { field: "organizationId", value: input.organizationId },
      { field: "userId", value: input.userId },
    ],
  });

  if (existingMember) {
    if (!isMemberRecord(existingMember)) {
      throw new Error("Demo member lookup did not return a member id.");
    }
    await adapter.update({
      model: "member",
      update: { role: DEMO_MEMBER_ROLE },
      where: [{ field: "id", value: existingMember.id }],
    });
    return;
  }

  await adapter.create({
    forceAllowId: true,
    model: "member",
    data: {
      createdAt: new Date(),
      id: memberId,
      organizationId: input.organizationId,
      role: DEMO_MEMBER_ROLE,
      userId: input.userId,
    },
  });
}

/**
 * Provisions a customer workspace with owner access, package entitlement, and
 * onboarding metadata.
 *
 * This gives customer success and sales a repeatable handoff path for the
 * first workspace a buyer touches: the signed-in operator, package gates, demo
 * data handoff, and first saved views all refer to the same workspace identity.
 *
 * @param input - Customer workspace and operator identity.
 */
export async function provisionCustomerWorkspace(
  input: CustomerWorkspaceProvisionInput,
): Promise<CustomerWorkspaceProvisionResult> {
  validateCustomerWorkspaceProvisionInput(input);
  const auth = await ensureAuthReady();
  const context = await auth.$context;
  const provisionedAt = new Date();

  await upsertDemoUser(context.internalAdapter, input);
  await upsertDemoOrganization(context.adapter, input, provisionedAt);
  await upsertDemoMembership(context.adapter, input);
  await grantWorkspaceProduct({
    product: input.product,
    workspaceId: input.organizationId,
  });

  return {
    demoDataSeed: input.demoDataSeed,
    firstSavedViews: [...input.firstSavedViews],
    organizationId: input.organizationId,
    product: input.product,
    seedCommand: demoDataSeedCommand(input),
    userId: input.userId,
  };
}

/**
 * Provisions the hosted Briefing Room demo workspace and Team access.
 *
 * This makes the buyer demo use the same workspace, membership, and product
 * checks as a real Team customer, so the visible brief flow is not a local-only
 * shortcut.
 *
 * @param input - Demo workspace and operator identity.
 */
export async function provisionBriefingRoomDemoWorkspace(
  input: BriefingRoomDemoWorkspaceInput,
): Promise<BriefingRoomDemoWorkspaceResult> {
  const result = await provisionCustomerWorkspace({
    ...input,
    demoDataSeed: DEMO_DATA_SEED,
    firstSavedViews: BRIEFING_ROOM_FIRST_SAVED_VIEWS,
    product: DEMO_PRODUCT,
  });

  return {
    organizationId: result.organizationId,
    product: result.product,
    userId: result.userId,
  };
}
