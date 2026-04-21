import { z } from "zod";

/**
 * The two workspace shapes Atlas currently supports.
 *
 * `individual` keeps the product in a personal mode with no team-management UI.
 * `team` unlocks organization management, invitations, and collaborative copy.
 */
export const atlasWorkspaceTypeSchema = z.enum(["individual", "team"]);

export type AtlasWorkspaceType = z.infer<typeof atlasWorkspaceTypeSchema>;

/**
 * Capability flags derived from the active workspace type and membership role.
 *
 * These flags let the UI progressively enhance or degrade without hard-coding
 * plan or role checks in every component.
 */
export interface AtlasWorkspaceCapabilities {
  canInviteMembers: boolean;
  canManageOrganization: boolean;
  canSwitchOrganizations: boolean;
  canUseTeamFeatures: boolean;
}

/**
 * Normalized organization metadata Atlas stores inside Better Auth's
 * organization `metadata` field.
 */
export interface AtlasOrganizationMetadata {
  ssoPrimaryProviderId: string | null;
  stripeCustomerId: string | null;
  workspaceType: AtlasWorkspaceType;
}

const atlasOrganizationMetadataSchema = z
  .object({
    ssoPrimaryProviderId: z.string().trim().min(1).nullish(),
    stripeCustomerId: z.string().trim().min(1).nullish(),
    workspaceType: atlasWorkspaceTypeSchema.optional(),
  })
  .passthrough();

/**
 * Parses raw Better Auth metadata into a plain object before Atlas validates
 * it. SQLite-backed Better Auth deployments persist organization metadata as
 * JSON text, so Atlas accepts either the already-decoded object form or the
 * serialized string form.
 *
 * @param metadata - The raw metadata value from Better Auth.
 */
function parseAtlasOrganizationMetadataInput(metadata: unknown): unknown {
  if (typeof metadata !== "string") {
    return metadata;
  }

  try {
    return JSON.parse(metadata);
  } catch {
    return metadata;
  }
}

/**
 * Normalizes organization metadata coming back from Better Auth into the small
 * Atlas contract that the rest of the app depends on.
 */
export function normalizeAtlasOrganizationMetadata(metadata: unknown): AtlasOrganizationMetadata {
  const metadataInput = parseAtlasOrganizationMetadataInput(metadata ?? {});
  const parsed = atlasOrganizationMetadataSchema.safeParse(metadataInput);

  return {
    ssoPrimaryProviderId:
      parsed.success && parsed.data.ssoPrimaryProviderId ? parsed.data.ssoPrimaryProviderId : null,
    stripeCustomerId:
      parsed.success && parsed.data.stripeCustomerId ? parsed.data.stripeCustomerId : null,
    workspaceType:
      parsed.success && parsed.data.workspaceType ? parsed.data.workspaceType : "individual",
  };
}

/**
 * Merges one partial metadata patch into Atlas's normalized organization
 * metadata shape.
 *
 * @param metadata - The raw Better Auth organization metadata.
 * @param updates - The Atlas metadata fields to update.
 */
export function mergeAtlasOrganizationMetadata(
  metadata: unknown,
  updates: Partial<AtlasOrganizationMetadata>,
): AtlasOrganizationMetadata {
  const normalizedMetadata = normalizeAtlasOrganizationMetadata(metadata);

  return {
    ssoPrimaryProviderId:
      updates.ssoPrimaryProviderId === undefined
        ? normalizedMetadata.ssoPrimaryProviderId
        : updates.ssoPrimaryProviderId,
    stripeCustomerId:
      updates.stripeCustomerId === undefined
        ? normalizedMetadata.stripeCustomerId
        : updates.stripeCustomerId,
    workspaceType: updates.workspaceType ?? normalizedMetadata.workspaceType,
  };
}

/**
 * Returns whether the given membership role can manage organization settings.
 */
export function canManageAtlasOrganizationRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Converts the active workspace context into UI-facing capability flags.
 */
export function buildAtlasWorkspaceCapabilities(
  workspaceType: AtlasWorkspaceType | null,
  role: string | null | undefined,
  membershipCount: number,
): AtlasWorkspaceCapabilities {
  const canManageOrganization =
    workspaceType === "team" && canManageAtlasOrganizationRole(role ?? null);

  return {
    canInviteMembers: canManageOrganization,
    canManageOrganization,
    canSwitchOrganizations: membershipCount > 1,
    canUseTeamFeatures: workspaceType === "team",
  };
}
