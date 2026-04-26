import { useQuery, useQueryClient } from "@tanstack/react-query";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import type { AtlasSessionPayload } from "@/domains/access/organization-contracts";
import { getOrganizationDetails } from "@/domains/access/organizations.functions";

export const organizationQueryKey = ["auth", "organization"] as const;

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
  session: AtlasSessionPayload | null | undefined;
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

    await Promise.all([invalidateSessionPromise, invalidateOrganizationPromise]);
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
    session,
  };
}
