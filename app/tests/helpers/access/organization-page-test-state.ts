import { vi } from "vitest";
import type { AtlasOrganizationDetails } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import type { AtlasSessionPayload } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import { createOrganizationDetailsFixture } from "../../fixtures/access/organizations";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../../fixtures/access/sessions";
import { createMutationHookStub } from "../../helpers/react-query-stubs";

type MockFn = ReturnType<typeof vi.fn>;

interface OrganizationPageDependencyMocks {
  acceptWorkspaceInvitation: MockFn;
  cancelWorkspaceInvitation: MockFn;
  convertWorkspaceToTeam: MockFn;
  createWorkspace: MockFn;
  deleteWorkspaceSSOProvider: MockFn;
  getOrganizationDetails: MockFn;
  getWorkspaceSAMLAllowedIssuers: MockFn;
  invalidateQueries: MockFn;
  inviteWorkspaceMember: MockFn;
  leaveWorkspace: MockFn;
  registerWorkspaceGoogleOIDCProvider: MockFn;
  registerWorkspaceSAMLProvider: MockFn;
  rejectWorkspaceInvitation: MockFn;
  resendWorkspaceInvitation: MockFn;
  removeWorkspaceMember: MockFn;
  requestWorkspaceSSODomainVerification: MockFn;
  rotateWorkspaceSAMLCertificate: MockFn;
  setActiveWorkspace: MockFn;
  setWorkspacePrimarySSOProvider: MockFn;
  updateWorkspaceMemberRole: MockFn;
  updateWorkspaceProfile: MockFn;
  useAtlasSession: MockFn;
  useMutation: MockFn;
  useQuery: MockFn;
  useQueryClient: MockFn;
  verifyWorkspaceSSODomain: MockFn;
}

const organizationPageDependencyMocks: OrganizationPageDependencyMocks = vi.hoisted(() => ({
  acceptWorkspaceInvitation: vi.fn(),
  cancelWorkspaceInvitation: vi.fn(),
  convertWorkspaceToTeam: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspaceSSOProvider: vi.fn(),
  getOrganizationDetails: vi.fn(),
  getWorkspaceSAMLAllowedIssuers: vi.fn(),
  invalidateQueries: vi.fn(),
  inviteWorkspaceMember: vi.fn(),
  leaveWorkspace: vi.fn(),
  registerWorkspaceGoogleOIDCProvider: vi.fn(),
  registerWorkspaceSAMLProvider: vi.fn(),
  rejectWorkspaceInvitation: vi.fn(),
  resendWorkspaceInvitation: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  requestWorkspaceSSODomainVerification: vi.fn(),
  rotateWorkspaceSAMLCertificate: vi.fn(),
  setActiveWorkspace: vi.fn(),
  setWorkspacePrimarySSOProvider: vi.fn(),
  updateWorkspaceMemberRole: vi.fn(),
  updateWorkspaceProfile: vi.fn(),
  useAtlasSession: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  verifyWorkspaceSSODomain: vi.fn(),
}));

export { organizationPageDependencyMocks };

export interface OrganizationPageTestState {
  organization: AtlasOrganizationDetails;
  session: AtlasSessionPayload;
}

/**
 * Resets organization-page dependency mocks and returns the default session
 * and organization fixtures used by the harness.
 */
export function prepareOrganizationPageTestState(): OrganizationPageTestState {
  organizationPageDependencyMocks.acceptWorkspaceInvitation.mockReset();
  organizationPageDependencyMocks.cancelWorkspaceInvitation.mockReset();
  organizationPageDependencyMocks.createWorkspace.mockReset();
  organizationPageDependencyMocks.deleteWorkspaceSSOProvider.mockReset();
  organizationPageDependencyMocks.getOrganizationDetails.mockReset();
  organizationPageDependencyMocks.invalidateQueries.mockReset();
  organizationPageDependencyMocks.inviteWorkspaceMember.mockReset();
  organizationPageDependencyMocks.leaveWorkspace.mockReset();
  organizationPageDependencyMocks.registerWorkspaceGoogleOIDCProvider.mockReset();
  organizationPageDependencyMocks.registerWorkspaceSAMLProvider.mockReset();
  organizationPageDependencyMocks.rejectWorkspaceInvitation.mockReset();
  organizationPageDependencyMocks.removeWorkspaceMember.mockReset();
  organizationPageDependencyMocks.requestWorkspaceSSODomainVerification.mockReset();
  organizationPageDependencyMocks.setActiveWorkspace.mockReset();
  organizationPageDependencyMocks.setWorkspacePrimarySSOProvider.mockReset();
  organizationPageDependencyMocks.updateWorkspaceMemberRole.mockReset();
  organizationPageDependencyMocks.updateWorkspaceProfile.mockReset();
  organizationPageDependencyMocks.useAtlasSession.mockReset();
  organizationPageDependencyMocks.useMutation.mockReset();
  organizationPageDependencyMocks.useQuery.mockReset();
  organizationPageDependencyMocks.useQueryClient.mockReset();
  organizationPageDependencyMocks.verifyWorkspaceSSODomain.mockReset();

  organizationPageDependencyMocks.acceptWorkspaceInvitation.mockResolvedValue({ ok: true });
  organizationPageDependencyMocks.cancelWorkspaceInvitation.mockResolvedValue({ ok: true });
  organizationPageDependencyMocks.createWorkspace.mockResolvedValue({
    id: "org_new",
    slug: "policy-research",
  });
  organizationPageDependencyMocks.deleteWorkspaceSSOProvider.mockResolvedValue({ ok: true });
  organizationPageDependencyMocks.getOrganizationDetails.mockResolvedValue(
    createOrganizationDetailsFixture(),
  );
  organizationPageDependencyMocks.invalidateQueries.mockResolvedValue(undefined);
  organizationPageDependencyMocks.inviteWorkspaceMember.mockResolvedValue({
    id: "invite_456",
    status: "pending",
  });
  organizationPageDependencyMocks.leaveWorkspace.mockResolvedValue({ ok: true });
  organizationPageDependencyMocks.registerWorkspaceGoogleOIDCProvider.mockResolvedValue({
    domainVerificationToken: "token_123",
    providerId: "atlas-team-google-workspace-oidc",
    redirectUrl: "https://atlas.test/api/auth/sso/callback",
    samlAcsUrl: "https://atlas.test/api/auth/sso/saml2/sp/acs/atlas-team-google-workspace-saml",
    samlEntityId:
      "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
    samlMetadataUrl:
      "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
  });
  organizationPageDependencyMocks.registerWorkspaceSAMLProvider.mockResolvedValue({
    domainVerificationToken: "token_456",
    providerId: "atlas-team-google-workspace-saml",
    redirectUrl: "https://atlas.test/api/auth/sso/callback",
    samlAcsUrl: "https://atlas.test/api/auth/sso/saml2/sp/acs/atlas-team-google-workspace-saml",
    samlEntityId:
      "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
    samlMetadataUrl:
      "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
  });
  organizationPageDependencyMocks.rejectWorkspaceInvitation.mockResolvedValue({ ok: true });
  organizationPageDependencyMocks.removeWorkspaceMember.mockResolvedValue({ ok: true });
  organizationPageDependencyMocks.requestWorkspaceSSODomainVerification.mockResolvedValue({
    domainVerificationToken: "token_789",
  });
  organizationPageDependencyMocks.setActiveWorkspace.mockResolvedValue({ ok: true });
  organizationPageDependencyMocks.setWorkspacePrimarySSOProvider.mockResolvedValue({ ok: true });
  organizationPageDependencyMocks.updateWorkspaceMemberRole.mockResolvedValue({ ok: true });
  organizationPageDependencyMocks.updateWorkspaceProfile.mockResolvedValue({ ok: true });
  organizationPageDependencyMocks.useMutation.mockImplementation(createMutationHookStub());
  organizationPageDependencyMocks.useQueryClient.mockReturnValue({
    invalidateQueries: organizationPageDependencyMocks.invalidateQueries,
  });
  organizationPageDependencyMocks.verifyWorkspaceSSODomain.mockResolvedValue({ ok: true });

  const session = createAtlasSessionFixture({
    workspace: createAtlasWorkspace({
      resolvedCapabilities: {
        capabilities: [
          "research.run",
          "research.unlimited",
          "workspace.notes",
          "workspace.export",
          "workspace.shared",
          "api.keys",
          "api.mcp",
          "monitoring.watchlists",
          "auth.sso",
          "auth.scim",
        ],
        limits: {
          research_runs_per_month: null,
          max_shortlists: null,
          max_shortlist_entries: null,
          max_api_keys: null,
          api_requests_per_day: 10000,
          public_api_requests_per_hour: null,
          max_members: 50,
        },
      },
    }),
  });
  const organization = createOrganizationDetailsFixture();

  return {
    organization,
    session,
  };
}
