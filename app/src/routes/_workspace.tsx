import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { useAtlasSession } from "@/domains/access";
import { getAuthClient } from "@/domains/access/client/auth-client";
import { atlasSessionQueryKey } from "@/domains/access/client/use-atlas-session";
import { setActiveWorkspace } from "@/domains/access/organizations.functions";
import { requireReadyAtlasSession } from "@/domains/access/server";
import { getRpLogoutRedirect } from "@/domains/access/session.functions";
import type { AtlasSessionPayload } from "@/domains/access/organization-contracts";

import { WorkspaceLayout } from "@/platform/layout/workspace-layout";
import { Select } from "@/platform/ui/select";

interface WorkspaceTabConfig {
  label: string;
  to: string;
}

/**
 * Props needed to render the workspace identity controls in the shared shell.
 */
interface OperatorIdentityProps {
  session: AtlasSessionPayload;
}

export const Route = createFileRoute("/_workspace")({
  beforeLoad: async ({ location }) => {
    return {
      session: await requireReadyAtlasSession(location.href),
    };
  },
  component: WorkspaceRoute,
});

/**
 * Returns whether the workspace shell should surface the organization tab for
 * the current session.
 *
 * @param session - The current Atlas session payload.
 */
function shouldShowOrganizationTab(session: AtlasSessionPayload): boolean {
  const activeWorkspace = session.workspace.activeOrganization;

  return (
    session.workspace.onboarding.needsWorkspace ||
    session.workspace.onboarding.hasPendingInvitations ||
    session.workspace.capabilities.canSwitchOrganizations ||
    activeWorkspace?.workspaceType === "team"
  );
}

/**
 * Builds the workspace tab list for the current session.
 *
 * @param session - The current Atlas session payload.
 */
function buildWorkspaceTabs(session: AtlasSessionPayload | null | undefined): WorkspaceTabConfig[] {
  const tabs: WorkspaceTabConfig[] = [{ label: "Discovery", to: "/discovery" }];

  if (!session || session.isLocal) {
    return tabs;
  }

  if (shouldShowOrganizationTab(session)) {
    tabs.push({ label: "Organization", to: "/organization" });
  }

  tabs.push({ label: "Account", to: "/account" });

  return tabs;
}

function WorkspaceRoute() {
  const session = useAtlasSession();
  const tabs = buildWorkspaceTabs(session.data);
  const sessionData = session.data;
  const showIdentity = sessionData != null && !sessionData.isLocal;

  return (
    <WorkspaceLayout
      tabs={tabs}
      identitySlot={showIdentity ? <OperatorIdentity session={sessionData} /> : null}
    >
      <Outlet />
    </WorkspaceLayout>
  );
}

function OperatorIdentity({ session }: OperatorIdentityProps) {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeWorkspace = session.workspace.activeOrganization;
  const displayName = session.user.name.trim() || session.user.email;
  const setActiveWorkspaceMutation = useMutation({
    mutationFn: (input: Parameters<typeof setActiveWorkspace>[0]) => setActiveWorkspace(input),
  });

  const canSwitchOrganizations = session.workspace.capabilities.canSwitchOrganizations;
  const handleSignOut = async () => {
    setErrorMessage(null);

    try {
      const rpLogout = await getRpLogoutRedirect();
      await getAuthClient().signOut();
      window.location.assign(rpLogout.url ?? "/");
    } catch {
      setErrorMessage("Atlas could not sign you out right now.");
    }
  };

  const handleWorkspaceSwitch = async (organizationId: string) => {
    setErrorMessage(null);

    try {
      await setActiveWorkspaceMutation.mutateAsync({
        data: {
          organizationId,
        },
      });

      await queryClient.invalidateQueries({
        queryKey: atlasSessionQueryKey,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Atlas could not switch workspaces right now.";
      setErrorMessage(message);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {canSwitchOrganizations ? (
          <div className="min-w-56">
            <Select
              value={activeWorkspace?.id ?? ""}
              onChange={(id) => {
                void handleWorkspaceSwitch(id);
              }}
              disabled={setActiveWorkspaceMutation.isPending}
              options={session.workspace.memberships.map(
                (membership: AtlasSessionPayload["workspace"]["memberships"][number]) => ({
                  label: membership.name,
                  value: membership.id,
                }),
              )}
            />
          </div>
        ) : activeWorkspace ? (
          <span className="type-body-medium border-outline-variant text-outline rounded-full border px-3 py-1">
            {activeWorkspace.name}
          </span>
        ) : null}

        <span className="type-body-medium text-outline">{displayName}</span>
        <button
          type="button"
          onClick={() => {
            void handleSignOut();
          }}
          className="type-label-large text-outline hover:bg-surface-container hover:text-on-surface inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>

      {errorMessage ? <p className="type-body-small text-outline">{errorMessage}</p> : null}
    </div>
  );
}
