// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { OrganizationPageController } from "@/domains/access/components/organization/organization-page-types";
import { OrganizationSSOPageView } from "@/domains/access/components/organization/organization-sso-page-view";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

describe("OrganizationSSOPageView", () => {
  const buildController = (overrides = {}) => ({
    needsWorkspace: false,
    canUseTeamFeatures: true,
    canSwitchOrganizations: false,
    hasPendingInvitations: false,
    organizationLoading: false,
    organization: {
      id: "org_1",
      name: "Atlas",
      slug: "atlas",
      sso: {
        providers: [],
        setup: {
          googleWorkspaceIssuer: "https://accounts.google.com",
          googleWorkspaceScopes: ["openid", "email", "profile"],
          oidcProviderIdSuggestion: "google",
          oidcRedirectUrl: "https://atlas.test/callback",
          samlAcsUrl: "https://atlas.test/acs",
          samlEntityId: "https://atlas.test/metadata",
          samlMetadataUrl: "https://atlas.test/metadata.xml",
          samlProviderIdSuggestion: "saml",
          workspaceDomainSuggestion: "atlas.test",
        },
      },
      metadata: { workspaceType: "team" },
      capabilities: { canUseTeamFeatures: true },
      role: "owner",
      workspaceType: "team",
    },
    domainVerificationTokens: {},
    oidcSetupForm: {
      clientId: "",
      clientSecret: "",
      domain: "",
      providerId: "",
      setAsPrimary: false,
    },
    samlSetupForm: {
      certificate: "",
      domain: "",
      entryPoint: "",
      issuer: "",
      providerId: "",
      setAsPrimary: false,
    },
    canManageOrganization: true,
    ...overrides,
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the header and basic structure", () => {
    const controller = buildController() as unknown as OrganizationPageController;
    render(<OrganizationSSOPageView controller={controller} />);
    expect(screen.getByText("Enterprise SSO setup")).toBeInTheDocument();
    expect(screen.getByText(/Configure enterprise sign-in/i)).toBeInTheDocument();
  });

  it("shows team requirement message for personal workspaces", () => {
    const controller = buildController({
      canUseTeamFeatures: false,
    }) as unknown as OrganizationPageController;
    render(<OrganizationSSOPageView controller={controller} />);
    expect(
      screen.getByText(/Enterprise SSO is available only for team workspaces/i),
    ).toBeInTheDocument();
  });
});
