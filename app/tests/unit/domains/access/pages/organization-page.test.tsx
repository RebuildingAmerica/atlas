// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { organizationPageDependencyMocks } from "../../../../helpers/access/organization-page-test-state";
import {
  createOrganizationDetailsFixture,
  createWorkspaceSSOProviderFixture,
  createWorkspaceSSOStateFixture,
} from "../../../../fixtures/access/organizations";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "../../../../fixtures/access/sessions";
import {
  renderOrganizationPage,
  renderOrganizationSSOPage,
  setAtlasSession,
  setOrganizationDetails,
} from "../../../../helpers/access/organization-page-test-harness";

describe("OrganizationPage", () => {
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

    expect(screen.getByRole("link", { name: "Enterprise sign-in" })).not.toBeNull();
    expect(screen.getByText("Manage enterprise SSO")).not.toBeNull();
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
    expect(screen.getByRole("link", { name: "Workspace" })).not.toBeNull();
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
});
