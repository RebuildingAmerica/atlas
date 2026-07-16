import type { AtlasProduct, SerializedResolvedCapabilities } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import type {
  AtlasSessionPayload,
  AtlasWorkspaceMembership,
  AtlasWorkspaceState,
} from "@rebuildingamerica/atlas-access/workspace/organization-contracts";

/**
 * Default resolved capabilities for a free-tier workspace with no active
 * products. Matches the values produced by `resolveCapabilities([])`.
 */
const DEFAULT_RESOLVED_CAPABILITIES: SerializedResolvedCapabilities = {
  capabilities: ["research.run"],
  limits: {
    research_runs_per_month: 2,
    max_shortlists: 1,
    max_shortlist_entries: 25,
    max_api_keys: 0,
    api_requests_per_day: 0,
    public_api_requests_per_hour: 100,
    max_members: 1,
  },
};

/**
 * Builds a serialized resolved-capabilities object for tests, overriding
 * individual limits on top of the free-tier defaults.
 *
 * @param limitOverrides - Limit values to override (e.g. a higher max_members).
 * @param capabilities - The capability set to expose.
 */
export function createAtlasResolvedCapabilities(
  limitOverrides: Partial<SerializedResolvedCapabilities["limits"]> = {},
  capabilities: SerializedResolvedCapabilities["capabilities"] = DEFAULT_RESOLVED_CAPABILITIES.capabilities,
): SerializedResolvedCapabilities {
  return {
    capabilities,
    limits: { ...DEFAULT_RESOLVED_CAPABILITIES.limits, ...limitOverrides },
  };
}

/**
 * Builds the Better Auth session payload Atlas reads through
 * `auth.api.getSession()`.
 *
 * @param options - Field overrides for the Better Auth session fixture.
 */
export function createBetterAuthSession(
  options: {
    activeOrganizationId?: string | null;
    email?: string;
    emailVerified?: boolean;
    image?: string | null;
    sessionId?: string;
    userId?: string;
    userName?: string;
  } = {},
) {
  return {
    session: {
      activeOrganizationId: options.activeOrganizationId,
      id: options.sessionId ?? "session_123",
    },
    user: {
      email: options.email ?? "operator@atlas.test",
      emailVerified: options.emailVerified ?? true,
      id: options.userId ?? "user_123",
      image: options.image ?? null,
      name: options.userName ?? "Operator",
    },
  };
}

/**
 * Builds the Better Auth organization summary Atlas reads through
 * `auth.api.listOrganizations()`.
 *
 * @param options - Field overrides for the Better Auth organization fixture.
 */
export function createBetterAuthOrganization(
  options: {
    id?: string;
    metadata?: Record<string, unknown>;
    name?: string;
    slug?: string;
  } = {},
) {
  return {
    id: options.id ?? "org_team",
    metadata: options.metadata ?? { workspaceType: "team" },
    name: options.name ?? "Atlas Team",
    slug: options.slug ?? "atlas-team",
  };
}

/**
 * Builds the Better Auth invitation payload Atlas reads through
 * `auth.api.listUserInvitations()`.
 *
 * @param options - Field overrides for the Better Auth invitation fixture.
 */
export function createBetterAuthInvitation(
  options: {
    email?: string;
    expiresAt?: Date | string | null;
    id?: string;
    organization?: {
      metadata?: Record<string, unknown>;
      name?: string;
      slug?: string;
    };
    organizationId?: string;
    organizationName?: string;
    organizationSlug?: string;
    role?: string;
    status?: string;
  } = {},
) {
  return {
    email: options.email ?? "operator@atlas.test",
    expiresAt: options.expiresAt ?? new Date("2026-04-20T12:00:00.000Z"),
    id: options.id ?? "invite_team_2",
    organization: options.organization ?? {
      metadata: { workspaceType: "team" },
      name: "Research Desk",
      slug: "research-desk",
    },
    organizationId: options.organizationId ?? "org_future",
    organizationName: options.organizationName ?? "Research Desk",
    organizationSlug: options.organizationSlug ?? "research-desk",
    role: options.role ?? "admin",
    status: options.status ?? "pending",
  };
}

/**
 * Builds the normalized Atlas workspace fixture used by access tests.
 *
 * @param options - Field overrides for the Atlas workspace fixture.
 */
export function createAtlasWorkspace(
  options: {
    activeOrganization?: AtlasWorkspaceState["activeOrganization"];
    activeProducts?: AtlasProduct[];
    capabilities?: Partial<AtlasWorkspaceState["capabilities"]>;
    memberships?: AtlasWorkspaceState["memberships"];
    onboarding?: Partial<AtlasWorkspaceState["onboarding"]>;
    pendingInvitations?: AtlasWorkspaceState["pendingInvitations"];
    resolvedCapabilities?: SerializedResolvedCapabilities;
    role?: string;
  } = {},
): AtlasWorkspaceState {
  const role = options.role ?? "owner";
  const activeOrganization =
    options.activeOrganization === undefined
      ? ({
          id: "org_team",
          name: "Atlas Team",
          role,
          slug: "atlas-team",
          workspaceType: "team",
        } as const as AtlasWorkspaceMembership)
      : options.activeOrganization;

  return {
    activeOrganization,
    activeProducts: options.activeProducts ?? [],
    capabilities: {
      canInviteMembers: options.capabilities?.canInviteMembers ?? true,
      canManageOrganization: options.capabilities?.canManageOrganization ?? true,
      canSwitchOrganizations: options.capabilities?.canSwitchOrganizations ?? false,
      canUseTeamFeatures: options.capabilities?.canUseTeamFeatures ?? true,
    },
    resolvedCapabilities: options.resolvedCapabilities ?? DEFAULT_RESOLVED_CAPABILITIES,
    memberships: options.memberships ?? [
      {
        id: "org_team",
        name: "Atlas Team",
        role: role,
        slug: "atlas-team",
        workspaceType: "team" as const,
      },
    ],
    onboarding: {
      hasPendingInvitations: options.onboarding?.hasPendingInvitations ?? false,
      needsWorkspace: options.onboarding?.needsWorkspace ?? false,
    },
    pendingInvitations: options.pendingInvitations ?? [],
  };
}

/**
 * Builds the normalized Atlas session fixture used in access tests.
 *
 * @param options - Field overrides for the Atlas session fixture.
 */
export function createAtlasSessionFixture(
  options: {
    isLocal?: boolean;
    accountReady?: boolean;
    hasPasskey?: boolean;
    passkeyCount?: number;
    sessionId?: string;
    user?: Partial<AtlasSessionPayload["user"]>;
    workspace?: AtlasWorkspaceState;
    role?: string;
  } = {},
): AtlasSessionPayload {
  return {
    isLocal: options.isLocal ?? false,
    accountReady: options.accountReady ?? true,
    hasPasskey: options.hasPasskey ?? true,
    passkeyCount: options.passkeyCount ?? 1,
    session: {
      id: options.sessionId ?? "session_123",
    },
    user: {
      email: options.user?.email ?? "operator@atlas.test",
      emailVerified: options.user?.emailVerified ?? true,
      id: options.user?.id ?? "user_123",
      image: options.user?.image ?? null,
      name: options.user?.name ?? "Operator",
    },
    workspace: options.workspace ?? createAtlasWorkspace({ role: options.role }),
  };
}

/**
 * Builds an `AtlasWorkspaceMembership` with sensible defaults for tests
 * that exercise multi-workspace UI.
 *
 * @param overrides - Membership fields the test wants to override.
 */
export function createAtlasWorkspaceMembership(
  overrides: Partial<AtlasWorkspaceMembership> = {},
): AtlasWorkspaceMembership {
  return {
    id: overrides.id ?? "org_a",
    name: overrides.name ?? "Atlas Team",
    role: overrides.role ?? "owner",
    slug: overrides.slug ?? "atlas-team",
    workspaceType: overrides.workspaceType ?? "team",
  };
}
