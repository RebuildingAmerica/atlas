import { vi } from "vitest";
import type { OrganizationPageController } from "@/domains/access/components/organization/organization-page-controller";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({}),
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/toast", () => ({
  useToast: () => ({
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/domains/access/components/organization/atproto-identity-section", () => ({
  OrganizationAtprotoIdentitySection: ({
    canManageOrganization,
    organizationId,
  }: {
    canManageOrganization: boolean;
    organizationId: string;
  }) => (
    <div data-can-manage-organization={canManageOrganization} data-organization-id={organizationId}>
      Organization ATProto identity
    </div>
  ),
}));

export const buildController = (overrides = {}): OrganizationPageController => {
  const baseController: OrganizationPageController = {
    needsWorkspace: false,
    canUseTeamFeatures: true,
    canSwitchOrganizations: false,
    hasPendingInvitations: false,
    organizationLoading: false,
    organization: {
      capabilities: {
        canInviteMembers: true,
        canManageOrganization: true,
        canSwitchOrganizations: false,
        canUseTeamFeatures: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "org_1",
      invitations: [],
      members: [],
      name: "Atlas",
      role: "owner",
      slug: "atlas",
      sso: {
        primaryHistory: [],
        primaryProviderId: null,
        providers: [],
        setup: {
          dnsTokenPrefix: "_atlas-sso",
          googleWorkspaceIssuer: "https://accounts.google.com",
          googleWorkspaceScopes: ["openid", "email", "profile"],
          oidcProviderIdSuggestion: "atlas-google-workspace-oidc",
          oidcRedirectUrl: "https://atlas.test/api/auth/sso/callback/atlas",
          samlAcsUrl: "https://atlas.test/api/auth/sso/saml2/atlas",
          samlEntityId: "https://atlas.test/saml/atlas",
          samlMetadataUrl: "https://atlas.test/api/auth/sso/saml2/atlas/metadata",
          samlProviderIdSuggestion: "atlas-google-workspace-saml",
          workspaceDomainSuggestion: "atlas.test",
        },
      },
      workspaceType: "team",
    },
    activeWorkspace: {
      id: "org_1",
      name: "Atlas",
      role: "owner",
      slug: "atlas",
      workspaceType: "team",
    },
    session: {
      accountReady: true,
      hasPasskey: true,
      isLocal: false,
      passkeyCount: 1,
      session: { id: "session_1" },
      user: {
        email: "user@atlas.test",
        emailVerified: true,
        id: "user_1",
        name: "Atlas User",
      },
      workspace: {
        activeOrganization: {
          id: "org_1",
          name: "Atlas",
          role: "owner",
          slug: "atlas",
          workspaceType: "team",
        },
        activeProducts: [],
        capabilities: {
          canInviteMembers: true,
          canManageOrganization: true,
          canSwitchOrganizations: false,
          canUseTeamFeatures: true,
        },
        memberships: [],
        onboarding: {
          hasPendingInvitations: false,
          needsWorkspace: false,
        },
        pendingInvitations: [],
        resolvedCapabilities: {
          capabilities: ["research.run", "workspace.shared"],
          limits: {
            api_requests_per_day: 0,
            max_api_keys: 0,
            max_members: 1,
            max_shortlist_entries: 25,
            max_shortlists: 1,
            public_api_requests_per_hour: 100,
            research_runs_per_month: 2,
          },
        },
      },
    },
    workspaceDelegatedEmail: "",
    workspaceDomain: "",
    workspaceName: "Atlas",
    workspaceSlug: "atlas",
    workspaceType: "team",
    setWorkspaceDelegatedEmail: vi.fn(),
    setWorkspaceDomain: vi.fn(),
    canManageOrganization: true,
    canUsePublicDirectories: false,
    createWorkspacePending: false,
    directoryConfigLoading: false,
    directoryConfigPending: false,
    directoryCorrectionPolicy: "",
    directoryEntryTypes: "",
    directoryGeographyLabels: "",
    directoryIssueAreaIds: "",
    directoryMethodologySummary: "",
    directoryReviewPolicy: "",
    directorySourcePolicy: "",
    directorySponsorLabel: "",
    directoryTitle: "",
    domainVerificationTokens: {},
    errorMessage: null,
    flashMessage: null,
    inviteEmail: "",
    invitePending: false,
    inviteRole: "member",
    leaveWorkspacePending: false,
    memberships: [],
    oidcSetupForm: {
      clientId: "",
      clientSecret: "",
      domain: "",
      providerId: "",
      setAsPrimary: true,
    },
    pendingInvitationMutationPending: false,
    pendingInvitations: [],
    profileName: "Atlas",
    profilePending: false,
    profileSlug: "atlas",
    removeMemberPending: false,
    resendInvitationPending: false,
    samlAllowedIssuerOrigins: [],
    samlSetupForm: {
      certificate: "",
      domain: "",
      entryPoint: "",
      issuer: "",
      providerId: "",
      setAsPrimary: true,
    },
    samlVerificationTimedOutProviderIds: [],
    selectWorkspacePending: false,
    selectedOrganizationId: "org_1",
    setDirectoryCorrectionPolicy: vi.fn(),
    setDirectoryEntryTypes: vi.fn(),
    setDirectoryGeographyLabels: vi.fn(),
    setDirectoryIssueAreaIds: vi.fn(),
    setDirectoryMethodologySummary: vi.fn(),
    setDirectoryReviewPolicy: vi.fn(),
    setDirectorySourcePolicy: vi.fn(),
    setDirectorySponsorLabel: vi.fn(),
    setDirectoryTitle: vi.fn(),
    setInviteEmail: vi.fn(),
    setInviteRole: vi.fn(),
    setOidcSetupForm: vi.fn(),
    setProfileName: vi.fn(),
    setProfileSlug: vi.fn(),
    setSamlSetupForm: vi.fn(),
    ssoMutationPending: false,
    teamSeatCostSummary: null,
    integrationMonitoring: undefined,
    integrationMonitoringLoading: false,
    updateWorkspaceMemberRolePending: false,
    upgradeToTeamPending: false,
    usageAuditLog: undefined,
    usageAuditLogLoading: false,
    usageSummary: undefined,
    usageSummaryLoading: false,
    onCreateWorkspace: vi.fn(),
    onDeleteSSOProvider: vi.fn(),
    onDirectoryConfigSave: vi.fn(),
    onInviteMember: vi.fn(),
    onInvitationDecision: vi.fn(),
    onLeaveWorkspace: vi.fn(),
    onOidcFormSubmit: vi.fn(),
    onProfileSave: vi.fn(),
    onRemoveMember: vi.fn(),
    onRequestDomainVerification: vi.fn(),
    onResendInvitation: vi.fn(),
    onRotateSAMLCertificate: vi.fn(),
    onSamlFormSubmit: vi.fn(),
    onSavePrimaryProvider: vi.fn(),
    onSelectWorkspace: vi.fn(),
    onUpdateInviteRole: vi.fn(),
    onUpdateMemberRole: vi.fn(),
    onUpdateWorkspaceName: vi.fn(),
    onUpdateWorkspaceSlug: vi.fn(),
    onUpdateWorkspaceType: vi.fn(),
    onUpgradeToTeam: vi.fn(),
    onVerifyDomain: vi.fn(),
  };

  return {
    ...baseController,
    ...overrides,
  };
};

const TEAM_SSO_LIMITS = {
  research_runs_per_month: null,
  max_shortlists: null,
  max_shortlist_entries: null,
  max_api_keys: null,
  api_requests_per_day: 10000,
  public_api_requests_per_hour: null,
  max_members: 50,
};

export function buildSsoController(overrides = {}): OrganizationPageController {
  return buildController({
    session: {
      user: { id: "user_1" },
      workspace: {
        resolvedCapabilities: {
          capabilities: ["research.run", "workspace.shared", "auth.sso"],
          limits: TEAM_SSO_LIMITS,
        },
      },
    },
    ...overrides,
  });
}
