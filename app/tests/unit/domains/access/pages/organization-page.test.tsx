// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AtlasOrganizationDetails } from "@/domains/access/organization-contracts";
import type { AtlasSessionPayload } from "@/domains/access/session.types";
import {
  createOrganizationDetailsFixture,
  createWorkspaceSSOProviderFixture,
  createWorkspaceSSOStateFixture,
} from "../../../../fixtures/access/organizations";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "../../../../fixtures/access/sessions";
import { organizationPageDependencyMocks } from "../../../../mocks/access/organization-page-dependencies";
import { createMutationHookStub, createQueryHookStub } from "../../../../utils/react-query-stubs";
import {
  TestButton,
  TestInput,
  TestLink,
  TestSelect,
  TestTextarea,
} from "../../../../utils/ui-stubs";

vi.mock("@/platform/ui/button", () => ({
  Button: TestButton,
}));

vi.mock("@/platform/ui/input", () => ({
  Input: TestInput,
}));

vi.mock("@/platform/ui/select", () => ({
  Select: TestSelect,
}));

vi.mock("@/platform/ui/textarea", () => ({
  Textarea: TestTextarea,
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: organizationPageDependencyMocks.useMutation,
  useQuery: organizationPageDependencyMocks.useQuery,
  useQueryClient: organizationPageDependencyMocks.useQueryClient,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: TestLink,
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["auth", "session"],
  useAtlasSession: organizationPageDependencyMocks.useAtlasSession,
}));

vi.mock("@/domains/access/organizations.functions", () => ({
  acceptWorkspaceInvitation: organizationPageDependencyMocks.acceptWorkspaceInvitation,
  cancelWorkspaceInvitation: organizationPageDependencyMocks.cancelWorkspaceInvitation,
  createWorkspace: organizationPageDependencyMocks.createWorkspace,
  getOrganizationDetails: organizationPageDependencyMocks.getOrganizationDetails,
  inviteWorkspaceMember: organizationPageDependencyMocks.inviteWorkspaceMember,
  leaveWorkspace: organizationPageDependencyMocks.leaveWorkspace,
  rejectWorkspaceInvitation: organizationPageDependencyMocks.rejectWorkspaceInvitation,
  removeWorkspaceMember: organizationPageDependencyMocks.removeWorkspaceMember,
  setActiveWorkspace: organizationPageDependencyMocks.setActiveWorkspace,
  updateWorkspaceMemberRole: organizationPageDependencyMocks.updateWorkspaceMemberRole,
  updateWorkspaceProfile: organizationPageDependencyMocks.updateWorkspaceProfile,
}));

vi.mock("@/domains/access/sso.functions", () => ({
  deleteWorkspaceSSOProvider: organizationPageDependencyMocks.deleteWorkspaceSSOProvider,
  registerWorkspaceGoogleOIDCProvider:
    organizationPageDependencyMocks.registerWorkspaceGoogleOIDCProvider,
  registerWorkspaceSAMLProvider: organizationPageDependencyMocks.registerWorkspaceSAMLProvider,
  requestWorkspaceSSODomainVerification:
    organizationPageDependencyMocks.requestWorkspaceSSODomainVerification,
  setWorkspacePrimarySSOProvider: organizationPageDependencyMocks.setWorkspacePrimarySSOProvider,
  verifyWorkspaceSSODomain: organizationPageDependencyMocks.verifyWorkspaceSSODomain,
}));

afterEach(() => {
  cleanup();
});

let atlasSession: AtlasSessionPayload;
let organizationDetails: AtlasOrganizationDetails | null;
let organizationLoading: boolean;
let refetchSession: ReturnType<typeof vi.fn>;

/**
 * Updates the mocked session hook with the supplied session fixture.
 *
 * @param session - The normalized Atlas session exposed to the page.
 */
function setAtlasSession(session: AtlasSessionPayload): void {
  atlasSession = session;
  refetchSession.mockResolvedValue({
    data: atlasSession,
  });

  organizationPageDependencyMocks.useAtlasSession.mockReturnValue({
    data: atlasSession,
    refetch: refetchSession,
  });
}

/**
 * Updates the mocked organization query with the supplied organization
 * fixture.
 *
 * @param details - The organization details visible to the page.
 * @param isLoading - Whether the organization query should report loading.
 */
function setOrganizationDetails(details: AtlasOrganizationDetails | null, isLoading = false): void {
  organizationDetails = details;
  organizationLoading = isLoading;
  organizationPageDependencyMocks.useQuery.mockImplementation(
    createQueryHookStub(organizationDetails, organizationLoading),
  );
}

/**
 * Loads and renders the workspace-management page under test.
 *
 * @param props - Optional initial organization data for the page.
 */
async function renderOrganizationPage(
  props: { initialOrganization?: AtlasOrganizationDetails | null } = {},
) {
  const organizationPageModule = await import("@/domains/access/pages/organization-page");
  const { OrganizationPage } = organizationPageModule;

  return render(<OrganizationPage {...props} />);
}

/**
 * Loads and renders the focused enterprise SSO page under test.
 *
 * @param props - Optional initial organization data for the page.
 */
async function renderOrganizationSSOPage(
  props: { initialOrganization?: AtlasOrganizationDetails | null } = {},
) {
  const organizationSSOPageModule = await import("@/domains/access/pages/organization-sso-page");
  const { OrganizationSSOPage } = organizationSSOPageModule;

  return render(<OrganizationSSOPage {...props} />);
}

describe("OrganizationPage", () => {
  beforeEach(() => {
    vi.resetModules();

    refetchSession = vi.fn();

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

    setAtlasSession(createAtlasSessionFixture());
    setOrganizationDetails(createOrganizationDetailsFixture());
  });

  it("renders team workspace management with a focused SSO setup link", async () => {
    const ssoProvider = createWorkspaceSSOProviderFixture({
      providerId: "atlas-team-google-workspace-saml",
      providerType: "saml",
      oidc: null,
      saml: {
        audience:
          "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
        authnRequestsSigned: false,
        callbackUrl:
          "https://atlas.test/api/auth/sso/saml2/sp/acs/atlas-team-google-workspace-saml",
        certificate: {
          errorMessage: null,
          fingerprintSha256: "AA:BB:CC",
          notAfter: "2027-04-12T00:00:00.000Z",
          notBefore: "2026-04-12T00:00:00.000Z",
          publicKeyAlgorithm: "rsaEncryption",
        },
        digestAlgorithm: null,
        entryPoint: "https://accounts.google.com/o/saml2/idp?idpid=abc123",
        identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        signatureAlgorithm: null,
        wantAssertionsSigned: true,
      },
    });
    const teamOrganization = createOrganizationDetailsFixture({
      sso: createWorkspaceSSOStateFixture({
        providers: [ssoProvider],
      }),
    });

    setOrganizationDetails(teamOrganization);

    await renderOrganizationPage();

    expect(screen.getByText("Enterprise sign-in")).not.toBeNull();
    expect(screen.getByText("Open focused SSO setup")).not.toBeNull();
    expect(screen.getByText("Primary provider: atlas-team-google-workspace-saml.")).not.toBeNull();
    expect(screen.queryByText("Configured providers")).toBeNull();
  });

  it("opens an enterprise setup-focused page for the deep link", async () => {
    await renderOrganizationSSOPage();

    expect(screen.getByText("Enterprise SSO setup")).not.toBeNull();
    expect(
      screen.getByText(
        "Use this page to configure Google Workspace OIDC, SAML 2.0, domain verification, and the workspace primary provider.",
      ),
    ).not.toBeNull();
    expect(screen.getByText("View full organization settings")).not.toBeNull();
  });

  it("prefills the workspace domain from the server suggestion", async () => {
    await renderOrganizationSSOPage();

    const workspaceDomainInputs = screen.getAllByLabelText("Workspace domain");
    const workspaceDomainValues = workspaceDomainInputs.map((input) => input.getAttribute("value"));

    expect(workspaceDomainValues).toEqual(["atlas.test", "atlas.test"]);
    expect(screen.getAllByText(/Suggested from your signed-in email:/)).toHaveLength(2);
  });

  it("submits the OIDC setup form with explicit domain and provider values", async () => {
    await renderOrganizationSSOPage();

    const workspaceDomainInputs = screen.getAllByLabelText("Workspace domain");
    const oidcWorkspaceDomainInput = workspaceDomainInputs.at(0);
    if (!oidcWorkspaceDomainInput) {
      throw new Error("No workspace domain inputs found");
    }

    fireEvent.change(oidcWorkspaceDomainInput, {
      target: { value: "policy.example" },
    });
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "client_123" },
    });
    fireEvent.change(screen.getByLabelText("Client secret"), {
      target: { value: "secret_456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Google Workspace OIDC" }));

    await waitFor(() => {
      expect(
        organizationPageDependencyMocks.registerWorkspaceGoogleOIDCProvider,
      ).toHaveBeenCalledWith({
        data: {
          clientId: "client_123",
          clientSecret: "secret_456",
          domain: "policy.example",
          providerId: "atlas-team-google-workspace-oidc",
          setAsPrimary: false,
        },
      });
    });

    expect(screen.getByText("Google Workspace OIDC saved.")).not.toBeNull();
  });

  it("creates a first workspace when the operator still needs one", async () => {
    const firstWorkspaceSession = createAtlasSessionFixture({
      workspace: createAtlasWorkspace({
        activeOrganization: null,
        capabilities: {
          canInviteMembers: false,
          canManageOrganization: false,
          canSwitchOrganizations: false,
          canUseTeamFeatures: false,
        },
        memberships: [],
        onboarding: {
          hasPendingInvitations: false,
          needsWorkspace: true,
        },
      }),
    });

    setAtlasSession(firstWorkspaceSession);
    setOrganizationDetails(null);

    await renderOrganizationPage();

    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Policy Research" },
    });
    fireEvent.change(screen.getByLabelText("Workspace slug"), {
      target: { value: "policy-research" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => {
      expect(organizationPageDependencyMocks.createWorkspace).toHaveBeenCalledWith({
        data: {
          name: "Policy Research",
          slug: "policy-research",
          workspaceType: "team",
        },
      });
    });
  });

  it("lets non-owner members leave the active team workspace", async () => {
    const memberSession = createAtlasSessionFixture({
      user: {
        id: "user_member",
      },
      workspace: createAtlasWorkspace({
        activeOrganization: {
          id: "org_team",
          name: "Atlas Team",
          role: "member",
          slug: "atlas-team",
          workspaceType: "team",
        },
        memberships: [
          {
            id: "org_team",
            name: "Atlas Team",
            role: "member",
            slug: "atlas-team",
            workspaceType: "team",
          },
        ],
      }),
    });
    const memberOrganization = createOrganizationDetailsFixture({
      role: "member",
    });

    setAtlasSession(memberSession);
    setOrganizationDetails(memberOrganization);

    await renderOrganizationPage();

    fireEvent.click(screen.getByRole("button", { name: "Leave workspace" }));

    await waitFor(() => {
      expect(organizationPageDependencyMocks.leaveWorkspace).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps team invitations and enterprise SSO hidden for individual workspaces", async () => {
    const individualWorkspace = createAtlasWorkspace({
      activeOrganization: {
        id: "org_personal",
        name: "Solo Desk",
        role: "owner",
        slug: "solo-desk",
        workspaceType: "individual",
      },
      capabilities: {
        canInviteMembers: false,
        canManageOrganization: false,
        canSwitchOrganizations: false,
        canUseTeamFeatures: false,
      },
      memberships: [
        {
          id: "org_personal",
          name: "Solo Desk",
          role: "owner",
          slug: "solo-desk",
          workspaceType: "individual",
        },
      ],
    });
    const individualOrganization = createOrganizationDetailsFixture({
      capabilities: {
        canInviteMembers: false,
        canManageOrganization: false,
        canSwitchOrganizations: false,
        canUseTeamFeatures: false,
      },
      invitations: [],
      members: [],
      name: "Solo Desk",
      role: "owner",
      slug: "solo-desk",
      workspaceType: "individual",
    });

    setAtlasSession(
      createAtlasSessionFixture({
        workspace: individualWorkspace,
      }),
    );
    setOrganizationDetails(individualOrganization);

    await renderOrganizationPage();

    expect(screen.queryByText("Invitations")).toBeNull();
    expect(screen.queryByText("Enterprise sign-in")).toBeNull();
    expect(
      screen.getByText(
        "This is a personal workspace, so Atlas keeps the shared-team controls out of the way.",
      ),
    ).not.toBeNull();
  });
});
