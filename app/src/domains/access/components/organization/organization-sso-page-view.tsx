import { hasSerializedCapability } from "@/domains/access/capabilities";
import type { OrganizationPageController } from "./organization-page-types";
import { OrganizationEmptyState } from "./organization-empty-state";
import { OrganizationLoadingState } from "./organization-loading-state";
import { OrganizationPageFeedback } from "./organization-page-feedback";
import { OrganizationPageHeader } from "./organization-page-header";
import { OrganizationTeamWorkspaceRequiredState } from "./organization-team-workspace-required-state";
import { PendingWorkspaceInvitationsSection } from "./pending-workspace-invitations-section";
import { WorkspaceCreationSection } from "./workspace-creation-section";
import { WorkspaceSSOSection } from "./workspace-sso-section";
import { WorkspaceSwitcherSection } from "./workspace-switcher-section";

/**
 * Props for the focused enterprise SSO setup view.
 */
interface OrganizationSSOPageViewProps {
  controller: OrganizationPageController;
}

/**
 * Focused enterprise sign-in setup view for OIDC, SAML, and domain
 * verification.
 */
export function OrganizationSSOPageView({ controller }: OrganizationSSOPageViewProps) {
  const canConfigureSSO = controller.session
    ? hasSerializedCapability(controller.session.workspace.resolvedCapabilities, "auth.sso")
    : false;
  if (!canConfigureSSO) {
    return (
      <div className="space-y-8 py-2">
        <OrganizationPageHeader
          description="Enterprise SSO configuration is not available for your current workspace plan."
          label="Enterprise SSO setup"
          links={[{ label: "View full organization settings", to: "/organization" }]}
          title="Enterprise sign-in"
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 py-2">
      <OrganizationPageHeader
        description="Use this page to configure Google Workspace OIDC, SAML 2.0, domain verification, and the workspace primary provider."
        label="Enterprise SSO setup"
        links={[{ label: "View full organization settings", to: "/organization" }]}
        title="Configure enterprise sign-in"
      />

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

      {controller.organization && controller.canUseTeamFeatures ? (
        <WorkspaceSSOSection
          canManageOrganization={controller.canManageOrganization}
          domainVerificationTokens={controller.domainVerificationTokens}
          isPending={controller.ssoMutationPending}
          oidcSetupForm={controller.oidcSetupForm}
          organization={controller.organization}
          samlSetupForm={controller.samlSetupForm}
          setOidcSetupForm={controller.setOidcSetupForm}
          setSamlSetupForm={controller.setSamlSetupForm}
          onDeleteProvider={controller.onDeleteSSOProvider}
          onOidcSubmit={controller.onOidcFormSubmit}
          onRequestDomainVerification={controller.onRequestDomainVerification}
          onSamlSubmit={controller.onSamlFormSubmit}
          onSavePrimaryProvider={controller.onSavePrimaryProvider}
          onVerifyDomain={controller.onVerifyDomain}
        />
      ) : null}

      {controller.organization && !controller.canUseTeamFeatures ? (
        <OrganizationTeamWorkspaceRequiredState />
      ) : null}

      {!controller.needsWorkspace &&
      !controller.hasPendingInvitations &&
      !controller.organization ? (
        <OrganizationEmptyState />
      ) : null}
    </div>
  );
}
