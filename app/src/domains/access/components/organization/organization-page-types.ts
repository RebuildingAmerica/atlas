import type { AtlasOrganizationDetails } from "@/domains/access/organization-contracts";
import type { AtlasSessionPayload } from "@/domains/access/session.types";

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
