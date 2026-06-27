import { hasSerializedCapability } from "@/domains/access/capabilities";
import { canManageAtlasOrganizationRole } from "@/domains/access/organization-metadata";
import { TeamSeatCostSection } from "@/domains/billing/components/team-seat-cost-section";
import type { OrganizationPageController } from "./organization-page-controller";
import { OrganizationEmptyState } from "./organization-empty-state";
import { OrganizationLoadingState } from "./organization-loading-state";
import { OrganizationPageFeedback } from "./organization-page-feedback";
import { OrganizationPageHeader } from "./organization-page-header";
import { OrganizationSSOSetupCard } from "./organization-sso-setup-card";
import { PendingWorkspaceInvitationsSection } from "./pending-workspace-invitations-section";
import { RolePermissionsGuide } from "./role-permissions-guide";
import { TeamInvitationsSection } from "./team-invitations-section";
import { TeamInviteUpsellSection } from "./team-invite-upsell-section";
import { TeamMembersSection } from "./team-members-section";
import { WorkspaceCreationSection } from "./workspace-creation-section";
import { WorkspaceMembershipSection } from "./workspace-membership-section";
import { WorkspaceProfileSection } from "./workspace-profile-section";
import { WorkspaceSwitcherSection } from "./workspace-switcher-section";
import { WorkspaceUpgradeSection } from "./workspace-upgrade-section";

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
  const canInviteMembers = controller.session
    ? hasSerializedCapability(controller.session.workspace.resolvedCapabilities, "workspace.shared")
    : false;
  // The upgrade-to-team affordance is a solo owner's action, not a team
  // "manage organization" capability (which is team-only). Gate it on the
  // operator actually owning/administering the active individual workspace.
  const canManageActiveWorkspace = canManageAtlasOrganizationRole(controller.activeWorkspace?.role);
  const pageLabel = controller.needsWorkspace
    ? "Workspace setup"
    : controller.canUseTeamFeatures
      ? "Organization"
      : "Workspace";
  const pageTitle = controller.needsWorkspace
    ? "Create your workspace"
    : (controller.organization?.name ?? controller.activeWorkspace?.name ?? "Workspace management");
  const pageDescription = controller.needsWorkspace
    ? "Create a workspace to start organizing your research."
    : controller.canUseTeamFeatures
      ? "Manage your shared workspace, team members, and invitations."
      : "Your personal workspace for individual research.";

  async function handleLeaveWorkspace() {
    const leaveWorkspacePromise = controller.onLeaveWorkspace();
    await leaveWorkspacePromise;
  }

  async function handleCancelInvitation(invitationId: string) {
    const cancelInvitationPromise = controller.onInvitationDecision(invitationId, "cancel");
    await cancelInvitationPromise;
  }

  async function handleResendInvitation(email: string, role: "admin" | "member") {
    const resendInvitationPromise = controller.onResendInvitation(email, role);
    await resendInvitationPromise;
  }

  async function handleUpgradeToTeam() {
    const upgradeToTeamPromise = controller.onUpgradeToTeam();
    await upgradeToTeamPromise;
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
          isPending={controller.createWorkspacePending}
          workspaceDelegatedEmail={controller.workspaceDelegatedEmail}
          workspaceDomain={controller.workspaceDomain}
          workspaceName={controller.workspaceName}
          workspaceSlug={controller.workspaceSlug}
          workspaceType={controller.workspaceType}
          onDelegatedEmailChange={controller.setWorkspaceDelegatedEmail}
          onDomainChange={controller.setWorkspaceDomain}
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
                <TeamSeatCostSection summary={controller.teamSeatCostSummary} />
              ) : null}

              {!controller.canUseTeamFeatures && canManageActiveWorkspace ? (
                <WorkspaceUpgradeSection
                  isPending={controller.upgradeToTeamPending}
                  memberCount={controller.organization.members.length}
                  onUpgrade={() => {
                    void handleUpgradeToTeam();
                  }}
                />
              ) : null}

              {controller.canUseTeamFeatures ? (
                <OrganizationSSOSetupCard organization={controller.organization} />
              ) : null}
            </div>

            {controller.canUseTeamFeatures ? (
              <div className="space-y-4">
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
                <RolePermissionsGuide />
              </div>
            ) : null}
          </section>

          {controller.canUseTeamFeatures && canInviteMembers ? (
            <TeamInvitationsSection
              canManageOrganization={controller.canManageOrganization}
              inviteEmail={controller.inviteEmail}
              inviteRole={controller.inviteRole}
              isCancelPending={controller.pendingInvitationMutationPending}
              isInvitePending={controller.invitePending}
              isResendPending={controller.resendInvitationPending}
              invitations={controller.organization.invitations}
              onCancel={(id) => {
                void handleCancelInvitation(id);
              }}
              onEmailChange={controller.setInviteEmail}
              onInviteRoleChange={controller.onUpdateInviteRole}
              onResend={(email, role) => {
                void handleResendInvitation(email, role);
              }}
              onSubmit={(e) => {
                void controller.onInviteMember(e);
              }}
            />
          ) : null}

          {controller.canUseTeamFeatures && !canInviteMembers ? <TeamInviteUpsellSection /> : null}
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
