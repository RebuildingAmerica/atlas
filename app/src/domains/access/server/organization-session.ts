import "@tanstack/react-start/server-only";

import { z } from "zod";
import { resolveCapabilities, serializeResolvedCapabilities } from "../capabilities";
import {
  buildAtlasWorkspaceCapabilities,
  normalizeAtlasOrganizationMetadata,
} from "../organization-metadata";
import { queryActiveProducts } from "./workspace-products";
import type { AtlasSessionPayload } from "../session.types";
import type { getAuth } from "./auth";
import type { atlasSessionSchema } from "./session-schema";

/**
 * The parsed Better Auth session record that Atlas extends with workspace
 * context.
 */
export type AtlasSessionRecord = z.infer<typeof atlasSessionSchema>;

/**
 * Better Auth instance shape used while Atlas normalizes workspace context.
 */
type AtlasAuthInstance = ReturnType<typeof getAuth>;

/**
 * Better Auth organization summary shape Atlas reads from `listOrganizations`.
 */
const organizationSummarySchema = z.object({
  id: z.string(),
  metadata: z.unknown().optional(),
  name: z.string(),
  slug: z.string(),
});

/**
 * Better Auth membership-role lookup result for the current user.
 */
const activeMemberRoleSchema = z.object({
  role: z.string(),
});

/**
 * Better Auth invitation shape Atlas reads from `listUserInvitations`.
 */
const organizationInvitationSchema = z.object({
  email: z.string(),
  expiresAt: z.union([z.date(), z.string(), z.null()]).optional(),
  id: z.string(),
  organization: z
    .object({
      metadata: z.unknown().optional(),
      name: z.string().optional(),
      slug: z.string().optional(),
    })
    .optional(),
  organizationId: z.string(),
  organizationName: z.string().optional(),
  organizationSlug: z.string().optional(),
  role: z.string(),
  status: z.string(),
});

/**
 * Serializes Better Auth date-like values into JSON-safe ISO strings.
 */
function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return value.toISOString();
}

/**
 * Loads the current user's membership summary for one Better Auth
 * organization.
 *
 * @param auth - The initialized Better Auth instance for the current server.
 * @param headers - The browser session headers used for auth-bound requests.
 * @param userId - The current signed-in user id.
 * @param organization - The Better Auth organization summary to normalize.
 */
async function loadAtlasMembership(
  auth: AtlasAuthInstance,
  headers: Headers,
  userId: string,
  organization: z.infer<typeof organizationSummarySchema>,
): Promise<AtlasSessionPayload["workspace"]["memberships"][number]> {
  const roleValue = await auth.api.getActiveMemberRole({
    headers,
    query: {
      organizationId: organization.id,
      userId,
    },
  });
  const { role } = activeMemberRoleSchema.parse(roleValue);
  const metadata = normalizeAtlasOrganizationMetadata(organization.metadata);

  return {
    id: organization.id,
    name: organization.name,
    role,
    slug: organization.slug,
    workspaceType: metadata.workspaceType,
  };
}

/**
 * Resolves the active organization from the normalized Atlas memberships.
 *
 * @param memberships - The normalized workspace memberships for the session.
 * @param activeOrganizationId - The Better Auth active-organization id when
 * present. Better Auth returns `null` before a user has selected or joined a
 * workspace.
 */
function resolveActiveOrganization(
  memberships: AtlasSessionPayload["workspace"]["memberships"],
  activeOrganizationId: string | null | undefined,
): AtlasSessionPayload["workspace"]["activeOrganization"] {
  for (const membership of memberships) {
    if (membership.id === activeOrganizationId) {
      return membership;
    }
  }

  return memberships[0] ?? null;
}

/**
 * Converts a pending Better Auth invitation into Atlas's workspace invitation
 * contract.
 *
 * @param invitation - The Better Auth invitation to normalize.
 */
function toAtlasWorkspaceInvitation(
  invitation: z.infer<typeof organizationInvitationSchema>,
): AtlasSessionPayload["workspace"]["pendingInvitations"][number] {
  const workspaceType = normalizeAtlasOrganizationMetadata(
    invitation.organization?.metadata,
  ).workspaceType;

  return {
    email: invitation.email,
    expiresAt: toIsoString(invitation.expiresAt),
    id: invitation.id,
    organizationId: invitation.organizationId,
    organizationName:
      invitation.organizationName ?? invitation.organization?.name ?? "Atlas Workspace",
    organizationSlug:
      invitation.organizationSlug ?? invitation.organization?.slug ?? invitation.organizationId,
    role: invitation.role,
    workspaceType,
  };
}

/**
 * Builds the workspace-aware portion of the Atlas session payload from Better
 * Auth organizations, roles, and invitations.
 *
 * @param auth - The initialized Better Auth instance for the current server.
 * @param headers - The browser session headers used for auth-bound requests.
 * @param session - The parsed Better Auth session that owns the workspace data.
 */
export async function loadAtlasWorkspaceState(
  auth: AtlasAuthInstance,
  headers: Headers,
  session: AtlasSessionRecord,
): Promise<AtlasSessionPayload["workspace"]> {
  const [organizationsValue, invitationsValue] = await Promise.all([
    auth.api.listOrganizations({ headers }),
    auth.api.listUserInvitations({
      headers,
      query: {
        email: session.user.email,
      },
    }),
  ]);

  const organizations = z.array(organizationSummarySchema).parse(organizationsValue);
  const invitations = z.array(organizationInvitationSchema).parse(invitationsValue);

  const memberships: AtlasSessionPayload["workspace"]["memberships"] = [];
  for (const organization of organizations) {
    const membership = await loadAtlasMembership(auth, headers, session.user.id, organization);
    memberships.push(membership);
  }

  const activeOrganization = resolveActiveOrganization(
    memberships,
    session.session.activeOrganizationId,
  );

  const activeProducts = activeOrganization ? await queryActiveProducts(activeOrganization.id) : [];
  const resolvedCaps = resolveCapabilities(activeProducts);

  const pendingInvitations: AtlasSessionPayload["workspace"]["pendingInvitations"] = [];
  for (const invitation of invitations) {
    if (invitation.status !== "pending") {
      continue;
    }

    const pendingInvitation = toAtlasWorkspaceInvitation(invitation);
    pendingInvitations.push(pendingInvitation);
  }

  return {
    activeOrganization,
    activeProducts,
    capabilities: buildAtlasWorkspaceCapabilities(
      activeOrganization?.workspaceType ?? null,
      activeOrganization?.role,
      memberships.length,
    ),
    resolvedCapabilities: serializeResolvedCapabilities(resolvedCaps),
    memberships,
    onboarding: {
      hasPendingInvitations: pendingInvitations.length > 0,
      needsWorkspace: memberships.length === 0 && pendingInvitations.length === 0,
    },
    pendingInvitations,
  };
}
