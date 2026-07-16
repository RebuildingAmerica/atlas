import type { AtlasProduct, SerializedResolvedCapabilities } from "../capabilities";
import type {
  AtlasSessionPayload,
  AtlasWorkspaceMembership,
  AtlasWorkspaceState,
} from "../organization-contracts";

const defaultResolvedCapabilities: SerializedResolvedCapabilities = {
  capabilities: ["research.run"],
  limits: {
    api_requests_per_day: 0,
    max_api_keys: 0,
    max_members: 1,
    max_shortlist_entries: 25,
    max_shortlists: 1,
    public_api_requests_per_hour: 100,
    research_runs_per_month: 2,
  },
};

export function createAtlasWorkspace(
  options: {
    activeOrganization?: AtlasWorkspaceState["activeOrganization"];
    activeProducts?: AtlasProduct[];
    capabilities?: Partial<AtlasWorkspaceState["capabilities"]>;
    memberships?: AtlasWorkspaceState["memberships"];
    onboarding?: Partial<AtlasWorkspaceState["onboarding"]>;
  } = {},
): AtlasWorkspaceState {
  const activeOrganization: AtlasWorkspaceMembership =
    options.activeOrganization ?? {
      id: "org_team",
      name: "Atlas Team",
      role: "owner",
      slug: "atlas-team",
      workspaceType: "team",
    };

  return {
    activeOrganization,
    activeProducts: options.activeProducts ?? [],
    capabilities: {
      canInviteMembers: options.capabilities?.canInviteMembers ?? true,
      canManageOrganization: options.capabilities?.canManageOrganization ?? true,
      canSwitchOrganizations: options.capabilities?.canSwitchOrganizations ?? false,
      canUseTeamFeatures: options.capabilities?.canUseTeamFeatures ?? true,
    },
    memberships: options.memberships ?? [activeOrganization],
    onboarding: {
      hasPendingInvitations: options.onboarding?.hasPendingInvitations ?? false,
      needsWorkspace: options.onboarding?.needsWorkspace ?? false,
    },
    pendingInvitations: [],
    resolvedCapabilities: defaultResolvedCapabilities,
  };
}

export function createAtlasSessionFixture(
  options: { role?: string; workspace?: AtlasWorkspaceState } = {},
): AtlasSessionPayload {
  return {
    accountReady: true,
    hasPasskey: true,
    isLocal: false,
    passkeyCount: 1,
    session: { id: "session_123" },
    user: {
      email: "operator@atlas.test",
      emailVerified: true,
      id: "user_123",
      image: null,
      name: "Operator",
    },
    workspace: options.workspace ?? createAtlasWorkspace({
      memberships: [
        {
          id: "org_team",
          name: "Atlas Team",
          role: options.role ?? "owner",
          slug: "atlas-team",
          workspaceType: "team",
        },
      ],
    }),
  };
}
