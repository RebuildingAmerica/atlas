import { z } from "zod";
import type { AtlasProduct, SerializedResolvedCapabilities } from "./capabilities";
import {
  buildAtlasWorkspaceCapabilities,
  normalizeAtlasOrganizationMetadata,
  type AtlasWorkspaceCapabilities,
  type AtlasWorkspaceType,
} from "./organization-metadata";
import type { AtlasWorkspaceSSOState } from "./organization-sso";

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

/**
 * Lightweight organization summary attached to a session.
 */
export interface AtlasWorkspaceMembership {
  id: string;
  name: string;
  role: string;
  slug: string;
  workspaceType: AtlasWorkspaceType;
}

/**
 * Pending invitation details that let Atlas explain available workspaces
 * before the user has accepted them.
 */
export interface AtlasWorkspaceInvitation {
  email: string;
  expiresAt: string | null;
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: string;
  workspaceType: AtlasWorkspaceType;
}

/**
 * Workspace context bundled into every normalized Atlas session payload.
 */
export interface AtlasWorkspaceState {
  activeOrganization: AtlasWorkspaceMembership | null;
  activeProducts: AtlasProduct[];
  capabilities: AtlasWorkspaceCapabilities;
  resolvedCapabilities: SerializedResolvedCapabilities;
  memberships: AtlasWorkspaceMembership[];
  onboarding: {
    hasPendingInvitations: boolean;
    needsWorkspace: boolean;
  };
  pendingInvitations: AtlasWorkspaceInvitation[];
}

/**
 * Normalized operator session payload returned by Atlas server functions.
 */
export interface AtlasSessionPayload {
  accountReady: boolean;
  hasPasskey: boolean;
  isLocal: boolean;
  passkeyCount: number;
  session: {
    id: string;
  };
  user: {
    email: string;
    emailVerified: boolean;
    id: string;
    name: string;
  };
  workspace: AtlasWorkspaceState;
}

// ---------------------------------------------------------------------------
// Workspace slug
// ---------------------------------------------------------------------------

/**
 * Workspace slug rules Atlas enforces for new and renamed workspaces.
 */
export const workspaceSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Use lowercase letters, numbers, and single hyphens only.",
  });

/**
 * Full Better Auth organization payload Atlas expects when loading the active
 * workspace management screen.
 */
export const organizationDetailsSchema = z
  .object({
    createdAt: z.union([z.date(), z.string()]),
    id: z.string(),
    invitations: z.array(
      z.object({
        createdAt: z.union([z.date(), z.string()]),
        email: z.string(),
        expiresAt: z.union([z.date(), z.string()]),
        id: z.string(),
        role: z.string(),
        status: z.string(),
      }),
    ),
    members: z.array(
      z.object({
        createdAt: z.union([z.date(), z.string()]),
        id: z.string(),
        organizationId: z.string(),
        role: z.string(),
        user: z.object({
          email: z.string(),
          id: z.string(),
          image: z.string().nullish(),
          name: z.string(),
        }),
        userId: z.string(),
      }),
    ),
    metadata: z.unknown().optional(),
    name: z.string(),
    slug: z.string(),
  })
  .nullable();

/**
 * Better Auth invitation payload returned when Atlas creates a new
 * organization invitation.
 */
export const invitationResultSchema = z.object({
  createdAt: z.union([z.date(), z.string()]),
  email: z.string(),
  expiresAt: z.union([z.date(), z.string()]),
  id: z.string(),
  organizationId: z.string(),
  role: z.string(),
  status: z.string(),
});

/**
 * Fully loaded member record for the active Atlas workspace.
 */
export interface AtlasOrganizationMemberRecord {
  createdAt: string;
  email: string;
  id: string;
  image: string | null;
  name: string;
  role: string;
  userId: string;
}

/**
 * Fully loaded invitation record for the active Atlas workspace.
 */
export interface AtlasOrganizationInvitationRecord {
  createdAt: string;
  email: string;
  expiresAt: string;
  id: string;
  role: string;
  status: string;
}

/**
 * Expanded workspace details used by the organization-management page.
 */
export interface AtlasOrganizationDetails {
  capabilities: AtlasWorkspaceCapabilities;
  createdAt: string;
  id: string;
  invitations: AtlasOrganizationInvitationRecord[];
  members: AtlasOrganizationMemberRecord[];
  name: string;
  role: string;
  slug: string;
  sso: AtlasWorkspaceSSOState;
  workspaceType: AtlasWorkspaceType;
}

/**
 * Serializes a Better Auth date-like value into an ISO string.
 *
 * @param value - The Better Auth date-like value to serialize.
 */
export function toIsoString(value: Date | string): string {
  if (typeof value === "string") {
    return value;
  }

  return value.toISOString();
}

/**
 * Normalizes the active Better Auth organization into Atlas's organization
 * page contract.
 *
 * @param details - The full Better Auth organization payload.
 * @param session - The normalized Atlas session payload for the current user.
 * @param sso - The normalized SSO state for the active workspace.
 */
export function toAtlasOrganizationDetails(
  details: z.infer<typeof organizationDetailsSchema>,
  session: AtlasSessionPayload,
  sso: AtlasWorkspaceSSOState,
): AtlasOrganizationDetails | null {
  if (!details) {
    return null;
  }

  const activeWorkspace = session.workspace.memberships.find(
    (membership) => membership.id === details.id,
  );
  const workspaceType = normalizeAtlasOrganizationMetadata(details.metadata).workspaceType;
  const role = activeWorkspace?.role ?? "member";

  const invitations: AtlasOrganizationInvitationRecord[] = [];
  for (const invitation of details.invitations) {
    invitations.push({
      createdAt: toIsoString(invitation.createdAt),
      email: invitation.email,
      expiresAt: toIsoString(invitation.expiresAt),
      id: invitation.id,
      role: invitation.role,
      status: invitation.status,
    });
  }

  const members: AtlasOrganizationMemberRecord[] = [];
  for (const member of details.members) {
    members.push({
      createdAt: toIsoString(member.createdAt),
      email: member.user.email,
      id: member.id,
      image: member.user.image ?? null,
      name: member.user.name,
      role: member.role,
      userId: member.userId,
    });
  }

  return {
    capabilities: buildAtlasWorkspaceCapabilities(
      workspaceType,
      role,
      session.workspace.memberships.length,
    ),
    createdAt: toIsoString(details.createdAt),
    id: details.id,
    invitations,
    members,
    name: details.name,
    role,
    slug: details.slug,
    sso,
    workspaceType,
  };
}
