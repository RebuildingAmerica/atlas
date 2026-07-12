import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { Building2, ChevronDown, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { useAtlasSession } from "@/domains/access";
import { signOutWithRedirect } from "@/domains/access/client/sign-out";
import { atlasSessionQueryKey } from "@/domains/access/client/use-atlas-session";
import { setActiveWorkspace } from "@/domains/access/organizations.functions";
import { requireReadyAtlasSession } from "@/domains/access/server";
import { getRpLogoutRedirect } from "@/domains/access/session.functions";
import type { AtlasSessionPayload } from "@/domains/access/organization-contracts";
import { ResumeCheckoutBanner } from "@/domains/billing/components/resume-checkout-banner";

import { buildAuthenticatedAppNav } from "@/platform/layout/app-navigation";
import { WorkspaceLayout } from "@/platform/layout/workspace-layout";
import { Select } from "@/platform/ui/select";

interface AppBarIdentityMenuProps {
  session: AtlasSessionPayload;
}

export const Route = createFileRoute("/_workspace")({
  beforeLoad: async ({ location }) => {
    const session = await requireReadyAtlasSession(location.href);
    if (shouldRedirectToWorkspaceSetup(session, location.href)) {
      throw redirect({ to: "/organization" });
    }

    return {
      session,
    };
  },
  component: WorkspaceRoute,
});

function shouldRedirectToWorkspaceSetup(
  session: AtlasSessionPayload,
  locationHref: string,
): boolean {
  if (session.isLocal || isWorkspaceSetupOrSettingsPath(getRoutePathname(locationHref))) {
    return false;
  }

  return (
    session.workspace.onboarding.needsWorkspace ||
    session.workspace.onboarding.hasPendingInvitations
  );
}

function isWorkspaceSetupOrSettingsPath(pathname: string): boolean {
  return (
    pathname === "/organization" ||
    pathname.startsWith("/organization/") ||
    pathname === "/account" ||
    pathname.startsWith("/account/")
  );
}

function getRoutePathname(locationHref: string): string {
  return new URL(locationHref, "https://atlas.localhost").pathname;
}

function WorkspaceRoute() {
  const { session: initialSession } = Route.useRouteContext();
  const session = useAtlasSession({ initialData: initialSession });
  const tabs = buildAuthenticatedAppNav(session.data);
  const sessionData = session.data;
  const showIdentity = sessionData != null && !sessionData.isLocal;
  const activeProducts =
    sessionData?.workspace.activeProducts ?? initialSession.workspace.activeProducts;

  return (
    <WorkspaceLayout
      tabs={tabs}
      identitySlot={showIdentity ? <AppBarIdentityMenu session={sessionData} /> : null}
    >
      <ResumeCheckoutBanner activeProducts={activeProducts} />
      <Outlet />
    </WorkspaceLayout>
  );
}

function AppBarIdentityMenu({ session }: AppBarIdentityMenuProps) {
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
      await signOutWithRedirect({
        redirectTo: rpLogout.url ?? "/",
        onError: () => {
          setErrorMessage("Atlas could not sign you out right now.");
        },
      });
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
              ariaLabel="Workspace"
              icon={Building2}
              size="compact"
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
          <span className="type-body-medium bg-surface-container text-outline rounded-full px-3 py-1">
            {activeWorkspace.name}
          </span>
        ) : null}

        {activeWorkspace?.workspaceType === "team" ? (
          <span
            className="type-label-small inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-emerald-800"
            title="This workspace can configure SAML or OIDC SSO."
          >
            Enterprise SSO
          </span>
        ) : null}

        <Popover className="relative">
          <PopoverButton
            aria-label="Profile menu"
            className="text-outline hover:bg-surface-container hover:text-on-surface focus-visible:ring-civic flex h-9 items-center gap-1 rounded-full px-1.5 outline-none focus-visible:ring-2"
          >
            <span className="bg-civic text-surface flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold">
              {displayName.trim().charAt(0).toUpperCase() || "A"}
            </span>
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </PopoverButton>
          <PopoverPanel
            anchor="bottom end"
            className="border-border bg-surface-container-lowest z-50 mt-2 w-64 rounded-lg border p-2 shadow-lg"
          >
            <div className="px-3 py-2">
              <p className="type-title-small text-ink-strong truncate">{displayName}</p>
              <p className="type-body-small text-ink-soft truncate">{session.user.email}</p>
            </div>
            <Link
              to="/account"
              className="type-body-medium text-ink-strong hover:bg-surface-container flex items-center gap-2 rounded-md px-3 py-2"
            >
              <UserRound className="h-4 w-4" />
              Account
            </Link>
            <button
              type="button"
              onClick={() => {
                void handleSignOut();
              }}
              className="type-body-medium text-ink-strong hover:bg-surface-container flex w-full items-center gap-2 rounded-md px-3 py-2 text-left"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </PopoverPanel>
        </Popover>
      </div>

      {errorMessage ? <p className="type-body-small text-outline">{errorMessage}</p> : null}
    </div>
  );
}
