import { useQuery, useQueryClient } from "@tanstack/react-query";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import type { AtlasSessionPayload } from "@/domains/access/organization-contracts";
import {
  getOrganizationDetails,
  getTeamSeatCostSummary,
} from "@/domains/access/organizations.functions";
import { getWorkspaceSAMLAllowedIssuers } from "@/domains/access/sso.functions";
import type { TeamSeatCostSummary } from "@/domains/billing/team-cost";

export const organizationQueryKey = ["auth", "organization"] as const;
export const samlAllowedIssuersQueryKey = ["auth", "saml-allowed-issuers"] as const;
export const teamSeatCostSummaryQueryKey = ["auth", "team-seat-cost-summary"] as const;

/**
 * Workspace-aware organization-page query state and refresh helpers.
 */
export interface OrganizationPageData {
  activeWorkspace: AtlasSessionPayload["workspace"]["activeOrganization"];
  atlasSession: ReturnType<typeof useAtlasSession>;
  canSwitchOrganizations: boolean;
  hasPendingInvitations: boolean;
  memberships: AtlasSessionPayload["workspace"]["memberships"];
  needsWorkspace: boolean;
  organization: Awaited<ReturnType<typeof getOrganizationDetails>> | null | undefined;
  organizationLoading: boolean;
  pendingInvitations: AtlasSessionPayload["workspace"]["pendingInvitations"];
  refreshWorkspaceData: () => Promise<void>;
  samlAllowedIssuerOrigins: readonly string[];
  session: AtlasSessionPayload | null | undefined;
  teamSeatCostSummary: TeamSeatCostSummary | null;
}

/**
 * Server-provided initial data for the organization-management page.
 */
interface UseOrganizationPageDataParams {
  initialOrganization?: Awaited<ReturnType<typeof getOrganizationDetails>> | null;
}

/**
 * Loads the session, active workspace query, and shared refresh logic for the
 * organization-management page.
 *
 * @param params - Optional server-provided initial data for the page.
 * @param params.initialOrganization - The initial active-workspace payload.
 */
export function useOrganizationPageData(
  params: UseOrganizationPageDataParams = {},
): OrganizationPageData {
  const queryClient = useQueryClient();
  const atlasSession = useAtlasSession();
  const session = atlasSession.data;
  const activeWorkspace = session?.workspace.activeOrganization ?? null;
  const memberships = session?.workspace.memberships ?? [];
  const pendingInvitations = session?.workspace.pendingInvitations ?? [];
  const canSwitchOrganizations = session?.workspace.capabilities.canSwitchOrganizations ?? false;
  const hasPendingInvitations = session?.workspace.onboarding.hasPendingInvitations ?? false;
  const needsWorkspace = session?.workspace.onboarding.needsWorkspace ?? false;

  const organizationQuery = useQuery({
    enabled: Boolean(activeWorkspace),
    queryFn: () => getOrganizationDetails(),
    initialData: params.initialOrganization,
    queryKey: [...organizationQueryKey, activeWorkspace?.id ?? "none"],
  });

  const samlAllowedIssuersQuery = useQuery({
    enabled: Boolean(activeWorkspace),
    queryFn: () => getWorkspaceSAMLAllowedIssuers(),
    queryKey: samlAllowedIssuersQueryKey,
    staleTime: 5 * 60 * 1000,
  });

  const teamSeatCostSummaryQuery = useQuery({
    enabled: activeWorkspace?.workspaceType === "team",
    queryFn: () => getTeamSeatCostSummary(),
    queryKey: [...teamSeatCostSummaryQueryKey, activeWorkspace?.id ?? "none"],
  });

  /**
   * Refreshes the session and active-organization query after a mutation.
   */
  async function refreshWorkspaceData() {
    const invalidateSessionPromise = queryClient.invalidateQueries({
      queryKey: atlasSessionQueryKey,
    });
    const invalidateOrganizationPromise = queryClient.invalidateQueries({
      queryKey: organizationQueryKey,
    });
    const invalidateTeamSeatCostPromise = queryClient.invalidateQueries({
      queryKey: teamSeatCostSummaryQueryKey,
    });

    await Promise.all([
      invalidateSessionPromise,
      invalidateOrganizationPromise,
      invalidateTeamSeatCostPromise,
    ]);
    await atlasSession.refetch();
  }

  return {
    activeWorkspace,
    atlasSession,
    canSwitchOrganizations,
    hasPendingInvitations,
    memberships,
    needsWorkspace,
    organization: organizationQuery.data,
    organizationLoading: organizationQuery.isLoading,
    pendingInvitations,
    refreshWorkspaceData,
    samlAllowedIssuerOrigins: samlAllowedIssuersQuery.data?.issuerOrigins ?? [],
    session,
    teamSeatCostSummary: teamSeatCostSummaryQuery.data ?? null,
  };
}
