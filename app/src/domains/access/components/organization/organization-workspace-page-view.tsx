import type { OrganizationPageController } from "./organization-page-types";
import { OrganizationEmptyState } from "./organization-empty-state";
import { OrganizationLoadingState } from "./organization-loading-state";
import { OrganizationPageFeedback } from "./organization-page-feedback";
import { OrganizationPageHeader } from "./organization-page-header";
import { OrganizationSSOSetupCard } from "./organization-sso-setup-card";
import { PendingWorkspaceInvitationsSection } from "./pending-workspace-invitations-section";
import { TeamInvitationsSection } from "./team-invitations-section";
import { TeamMembersSection } from "./team-members-section";
import { WorkspaceCreationSection } from "./workspace-creation-section";
import { WorkspaceMembershipSection } from "./workspace-membership-section";
import { WorkspaceProfileSection } from "./workspace-profile-section";
import { WorkspaceSwitcherSection } from "./workspace-switcher-section";

/**
 * Props for the main workspace-management view.
 */
interface OrganizationWorkspacePageViewProps {
  controller: OrganizationPageController;
}

/**
 * Main workspace-management view for profile, switching, members, and
 * invitations.
 */
export function OrganizationWorkspacePageView({ controller }: OrganizationWorkspacePageViewProps) {
  const inviteOnlyMode = true;
  const pageLabel = controller.needsWorkspace
    ? "Workspace setup"
    : controller.canUseTeamFeatures
      ? "Organization"
      : "Workspace";
  const pageTitle = controller.needsWorkspace
    ? "Choose the workspace you want to run"
    : (controller.organization?.name ?? controller.activeWorkspace?.name ?? "Workspace management");
  const pageDescription = controller.needsWorkspace
    ? "Create your first workspace so Atlas can keep roles, invitations, and workspace context consistent from the start."
    : controller.canUseTeamFeatures
      ? "Manage your shared workspace, keep invitations moving, and jump into focused enterprise sign-in setup only when you need it."
      : "Atlas keeps personal account security under Account and only surfaces shared workspace controls when they are actually useful.";

  async function handleLeaveWorkspace() {
    const leaveWorkspacePromise = controller.onLeaveWorkspace();
    await leaveWorkspacePromise;
  }

  async function handleCancelInvitation(invitationId: string) {
    const cancelInvitationPromise = controller.onInvitationDecision(invitationId, "cancel");
    await cancelInvitationPromise;
  }

  return (
    <div className="space-y-8 py-2">
      <OrganizationPageHeader description={pageDescription} label={pageLabel} title={pageTitle} />

      <OrganizationPageFeedback
        errorMessage={controller.errorMessage}
        flashMessage={controller.flashMessage}
      />

      {controller.canSwitchOrganizations ? (
        <WorkspaceSwitcherSection
          isPending={controller.selectWorkspacePending}
          memberships={controller.memberships}
          selectedOrganizationId={controller.selectedOrganizationId}
          onChange={(id) => {
            void controller.onSelectWorkspace(id);
          }}
        />
      ) : null}

      {controller.hasPendingInvitations ? (
        <PendingWorkspaceInvitationsSection
          invitations={controller.pendingInvitations}
          isPending={controller.pendingInvitationMutationPending}
          onDecision={(id, action) => {
            void controller.onInvitationDecision(id, action);
          }}
        />
      ) : null}

      {controller.needsWorkspace ? (
        <WorkspaceCreationSection
          inviteOnlyMode={inviteOnlyMode}
          isPending={controller.createWorkspacePending}
          workspaceName={controller.workspaceName}
          workspaceSlug={controller.workspaceSlug}
          workspaceType={controller.workspaceType}
          onNameChange={controller.onUpdateWorkspaceName}
          onSlugChange={controller.onUpdateWorkspaceSlug}
          onSubmit={(e) => {
            void controller.onCreateWorkspace(e);
          }}
          onWorkspaceTypeChange={controller.onUpdateWorkspaceType}
        />
      ) : null}

      {controller.organizationLoading ? <OrganizationLoadingState /> : null}

      {controller.organization ? (
        <div className="space-y-6">
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="space-y-6">
              <WorkspaceProfileSection
                canManageOrganization={controller.canManageOrganization}
                isPending={controller.profilePending}
                organization={controller.organization}
                profileName={controller.profileName}
                profileSlug={controller.profileSlug}
                onNameChange={controller.setProfileName}
                onSlugChange={controller.setProfileSlug}
                onSubmit={(e) => {
                  void controller.onProfileSave(e);
                }}
              />

              {controller.canUseTeamFeatures ? (
                <WorkspaceMembershipSection
                  isPending={controller.leaveWorkspacePending}
                  organization={controller.organization}
                  onLeave={() => {
                    void handleLeaveWorkspace();
                  }}
                />
              ) : null}

              {controller.canUseTeamFeatures ? (
                <OrganizationSSOSetupCard organization={controller.organization} />
              ) : null}
            </div>

            {controller.canUseTeamFeatures ? (
              <TeamMembersSection
                canManageOrganization={controller.canManageOrganization}
                currentUserId={controller.session?.user.id}
                isRemovePending={controller.removeMemberPending}
                members={controller.organization.members}
                onRemove={(id) => {
                  void controller.onRemoveMember(id);
                }}
                onRoleChange={(id, role) => {
                  void controller.onUpdateMemberRole(id, role);
                }}
              />
            ) : null}
          </section>

          {controller.canUseTeamFeatures ? (
            <TeamInvitationsSection
              canManageOrganization={controller.canManageOrganization}
              inviteEmail={controller.inviteEmail}
              inviteRole={controller.inviteRole}
              isCancelPending={controller.pendingInvitationMutationPending}
              isInvitePending={controller.invitePending}
              invitations={controller.organization.invitations}
              onCancel={(id) => {
                void handleCancelInvitation(id);
              }}
              onEmailChange={controller.setInviteEmail}
              onInviteRoleChange={controller.onUpdateInviteRole}
              onSubmit={(e) => {
                void controller.onInviteMember(e);
              }}
            />
          ) : null}
        </div>
      ) : null}

      {!controller.needsWorkspace &&
      !controller.hasPendingInvitations &&
      !controller.organization ? (
        <OrganizationEmptyState />
      ) : null}
    </div>
  );
}
