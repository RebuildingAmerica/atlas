// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { OrganizationPageController } from "@/domains/access/components/organization/organization-page-controller";
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
    session: {
      user: { id: "user_1" },
      workspace: {
        resolvedCapabilities: {
          capabilities: ["research.run", "workspace.shared", "auth.sso"],
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
      },
    },
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
    expect(screen.getAllByText(/Configure enterprise sign-in/i).length).toBeGreaterThan(0);
  });

  it("shows team requirement message for personal workspaces", () => {
    const controller = buildController({
      canUseTeamFeatures: false,
      session: {
        user: { id: "user_1" },
        workspace: {
          resolvedCapabilities: {
            capabilities: ["research.run"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
        },
      },
    }) as unknown as OrganizationPageController;
    render(<OrganizationSSOPageView controller={controller} />);
    expect(
      screen.getByText(
        /Enterprise SSO configuration is not available for your current workspace plan/i,
      ),
    ).toBeInTheDocument();
  });
});
