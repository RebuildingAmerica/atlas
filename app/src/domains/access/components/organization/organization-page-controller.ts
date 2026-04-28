import { useMemo, useState } from "react";
import type {
  AtlasOrganizationDetails,
  AtlasSessionPayload,
} from "@/domains/access/organization-contracts";
import { useOrganizationPageData } from "./use-organization-page-data";
import { useOrganizationPageForms } from "./use-organization-page-forms";
import { useOrganizationPageSSOActions } from "./use-organization-page-sso-actions";
import { useOrganizationPageWorkspaceActions } from "./use-organization-page-workspace-actions";

// ---------------------------------------------------------------------------
// Organization page types
// ---------------------------------------------------------------------------

/**
 * OIDC setup form state for the organization SSO section.
 */
export interface WorkspaceOIDCSetupFormState {
  clientId: string;
  clientSecret: string;
  domain: string;
  providerId: string;
  setAsPrimary: boolean;
}

/**
 * SAML setup form state for the organization SSO section.
 */
export interface WorkspaceSAMLSetupFormState {
  certificate: string;
  domain: string;
  entryPoint: string;
  issuer: string;
  providerId: string;
  setAsPrimary: boolean;
}

/**
 * Shared mutation status Atlas renders across the organization-management page.
 */
export interface OrganizationPageStatusState {
  errorMessage: string | null;
  flashMessage: string | null;
}

/**
 * Fully composed organization-page contract returned by the controller hook.
 */
export interface OrganizationPageController {
  activeWorkspace: AtlasSessionPayload["workspace"]["activeOrganization"];
  canManageOrganization: boolean;
  canSwitchOrganizations: boolean;
  canUseTeamFeatures: boolean;
  createWorkspacePending: boolean;
  domainVerificationTokens: Record<string, string>;
  errorMessage: string | null;
  flashMessage: string | null;
  hasPendingInvitations: boolean;
  inviteEmail: string;
  invitePending: boolean;
  inviteRole: "admin" | "member";
  leaveWorkspacePending: boolean;
  memberships: AtlasSessionPayload["workspace"]["memberships"];
  needsWorkspace: boolean;
  oidcSetupForm: WorkspaceOIDCSetupFormState;
  organization: AtlasOrganizationDetails | null | undefined;
  organizationLoading: boolean;
  pendingInvitationMutationPending: boolean;
  pendingInvitations: AtlasSessionPayload["workspace"]["pendingInvitations"];
  profileName: string;
  profilePending: boolean;
  profileSlug: string;
  removeMemberPending: boolean;
  samlAllowedIssuerOrigins: readonly string[];
  samlSetupForm: WorkspaceSAMLSetupFormState;
  selectWorkspacePending: boolean;
  selectedOrganizationId: string;
  session: AtlasSessionPayload | null | undefined;
  setInviteEmail: (value: string) => void;
  setInviteRole: (value: "admin" | "member") => void;
  setOidcSetupForm: (
    updater: (current: WorkspaceOIDCSetupFormState) => WorkspaceOIDCSetupFormState,
  ) => void;
  setProfileName: (value: string) => void;
  setProfileSlug: (value: string) => void;
  setSamlSetupForm: (
    updater: (current: WorkspaceSAMLSetupFormState) => WorkspaceSAMLSetupFormState,
  ) => void;
  ssoMutationPending: boolean;
  updateWorkspaceMemberRolePending: boolean;
  workspaceName: string;
  workspaceSlug: string;
  workspaceType: "individual" | "team";
  onCreateWorkspace: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onDeleteSSOProvider: (providerId: string) => Promise<void>;
  onInviteMember: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onInvitationDecision: (
    invitationId: string,
    action: "accept" | "cancel" | "reject",
  ) => Promise<void>;
  onLeaveWorkspace: () => Promise<void>;
  onOidcFormSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onProfileSave: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onRequestDomainVerification: (providerId: string) => Promise<void>;
  onSamlFormSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onSavePrimaryProvider: (providerId: string | null) => Promise<void>;
  onSelectWorkspace: (organizationId: string) => Promise<void>;
  onUpdateInviteRole: (value: string) => void;
  onUpdateMemberRole: (memberId: string, role: "admin" | "member") => Promise<void>;
  onUpdateWorkspaceName: (value: string) => void;
  onUpdateWorkspaceSlug: (value: string) => void;
  onUpdateWorkspaceType: (value: string) => void;
  onVerifyDomain: (providerId: string) => Promise<void>;
  onRemoveMember: (memberIdOrEmail: string) => Promise<void>;
}

/**
 * Optional server-provided initial data for the organization page.
 */
interface UseOrganizationPageControllerParams {
  initialOrganization?: AtlasOrganizationDetails | null;
}

/**
 * Central controller for the organization-management page.
 *
 * The page keeps server-backed fetching in dedicated hooks, while this
 * controller simply composes the current data, form state, and action groups
 * into one readable view model.
 *
 * @param params - Optional server-provided initial data for the page.
 * @param params.initialOrganization - The initial organization payload.
 */
export function useOrganizationPageController(
  params: UseOrganizationPageControllerParams = {},
): OrganizationPageController {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const data = useOrganizationPageData({
    initialOrganization: params.initialOrganization,
  });
  const forms = useOrganizationPageForms({
    activeOrganizationId: data.activeWorkspace?.id,
    needsWorkspace: data.needsWorkspace,
    organization: data.organization,
  });
  const feedback = useMemo(
    () => ({
      setErrorMessage,
      setFlashMessage,
    }),
    [],
  );
  const workspaceActions = useOrganizationPageWorkspaceActions({
    activeWorkspaceId: data.activeWorkspace?.id,
    feedback,
    forms,
    refreshWorkspaceData: data.refreshWorkspaceData,
  });
  const ssoActions = useOrganizationPageSSOActions({
    feedback,
    forms,
    refreshWorkspaceData: data.refreshWorkspaceData,
  });
  const canManageOrganization = data.organization?.capabilities.canManageOrganization ?? false;
  const canUseTeamFeatures = data.organization?.capabilities.canUseTeamFeatures ?? false;

  return {
    activeWorkspace: data.activeWorkspace,
    canManageOrganization,
    canSwitchOrganizations: data.canSwitchOrganizations,
    canUseTeamFeatures,
    createWorkspacePending: workspaceActions.createWorkspacePending,
    domainVerificationTokens: ssoActions.domainVerificationTokens,
    errorMessage,
    flashMessage,
    hasPendingInvitations: data.hasPendingInvitations,
    inviteEmail: forms.inviteEmail,
    invitePending: workspaceActions.invitePending,
    inviteRole: forms.inviteRole,
    leaveWorkspacePending: workspaceActions.leaveWorkspacePending,
    memberships: data.memberships,
    needsWorkspace: data.needsWorkspace,
    oidcSetupForm: forms.oidcSetupForm,
    organization: data.organization,
    organizationLoading: data.organizationLoading,
    pendingInvitationMutationPending: workspaceActions.pendingInvitationMutationPending,
    pendingInvitations: data.pendingInvitations,
    profileName: forms.profileName,
    profilePending: workspaceActions.profilePending,
    profileSlug: forms.profileSlug,
    removeMemberPending: workspaceActions.removeMemberPending,
    samlAllowedIssuerOrigins: data.samlAllowedIssuerOrigins,
    samlSetupForm: forms.samlSetupForm,
    selectWorkspacePending: workspaceActions.selectWorkspacePending,
    selectedOrganizationId: forms.selectedOrganizationId,
    session: data.session,
    setInviteEmail: forms.setInviteEmail,
    setInviteRole: forms.setInviteRole,
    setOidcSetupForm: forms.setOidcSetupForm,
    setProfileName: forms.setProfileName,
    setProfileSlug: forms.setProfileSlug,
    setSamlSetupForm: forms.setSamlSetupForm,
    ssoMutationPending: ssoActions.ssoMutationPending,
    updateWorkspaceMemberRolePending: workspaceActions.updateWorkspaceMemberRolePending,
    workspaceName: forms.workspaceName,
    workspaceSlug: forms.workspaceSlug,
    workspaceType: forms.workspaceType,
    onCreateWorkspace: workspaceActions.onCreateWorkspace,
    onDeleteSSOProvider: ssoActions.onDeleteSSOProvider,
    onInviteMember: workspaceActions.onInviteMember,
    onInvitationDecision: workspaceActions.onInvitationDecision,
    onLeaveWorkspace: workspaceActions.onLeaveWorkspace,
    onOidcFormSubmit: ssoActions.onOidcFormSubmit,
    onProfileSave: workspaceActions.onProfileSave,
    onRequestDomainVerification: ssoActions.onRequestDomainVerification,
    onSamlFormSubmit: ssoActions.onSamlFormSubmit,
    onSavePrimaryProvider: ssoActions.onSavePrimaryProvider,
    onSelectWorkspace: workspaceActions.onSelectWorkspace,
    onUpdateInviteRole: forms.onUpdateInviteRole,
    onUpdateMemberRole: workspaceActions.onUpdateMemberRole,
    onUpdateWorkspaceName: forms.onUpdateWorkspaceName,
    onUpdateWorkspaceSlug: forms.onUpdateWorkspaceSlug,
    onUpdateWorkspaceType: forms.onUpdateWorkspaceType,
    onVerifyDomain: ssoActions.onVerifyDomain,
    onRemoveMember: workspaceActions.onRemoveMember,
  };
}
