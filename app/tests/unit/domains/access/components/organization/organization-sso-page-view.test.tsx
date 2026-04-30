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

vi.mock("@/platform/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirm: () => Promise.resolve(true),
  }),
}));

vi.mock("@/platform/ui/toast", () => ({
  useToast: () => ({
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
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
    samlAllowedIssuerOrigins: ["https://accounts.google.com"] as readonly string[],
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

  it("renders the auth-disabled headline only when canConfigureSSO is false", () => {
    const controller = buildController({
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

  it("renders the workspace switcher when the operator can switch", () => {
    const controller = buildController({
      canSwitchOrganizations: true,
      memberships: [
        { id: "org_1", name: "Atlas", slug: "atlas", workspaceType: "team", role: "owner" },
        { id: "org_2", name: "Other", slug: "other", workspaceType: "team", role: "member" },
      ],
      selectedOrganizationId: "org_1",
      selectWorkspacePending: false,
      onSelectWorkspace: vi.fn(),
    }) as unknown as OrganizationPageController;
    render(<OrganizationSSOPageView controller={controller} />);
    expect(screen.getByText(/Other/)).toBeInTheDocument();
  });

  it("renders the pending invitations section when invitations exist", () => {
    const controller = buildController({
      hasPendingInvitations: true,
      pendingInvitations: [
        {
          id: "inv_1",
          email: "operator@atlas.test",
          organizationName: "Atlas Future",
          organizationSlug: "atlas-future",
          role: "admin",
          expiresAt: new Date("2099-01-01T00:00:00Z"),
        },
      ],
      pendingInvitationMutationPending: false,
      onInvitationDecision: vi.fn(),
    }) as unknown as OrganizationPageController;
    render(<OrganizationSSOPageView controller={controller} />);
    expect(screen.getAllByText(/Atlas Future/).length).toBeGreaterThan(0);
  });

  it("renders the workspace creation form when needsWorkspace is true", () => {
    const controller = buildController({
      needsWorkspace: true,
      organization: null,
      createWorkspacePending: false,
      workspaceDelegatedEmail: "",
      workspaceDomain: "",
      workspaceName: "",
      workspaceSlug: "",
      workspaceType: "individual",
      setWorkspaceDelegatedEmail: vi.fn(),
      setWorkspaceDomain: vi.fn(),
      onUpdateWorkspaceName: vi.fn(),
      onUpdateWorkspaceSlug: vi.fn(),
      onCreateWorkspace: vi.fn(),
      onUpdateWorkspaceType: vi.fn(),
    }) as unknown as OrganizationPageController;
    render(<OrganizationSSOPageView controller={controller} />);
    expect(screen.getAllByText(/Workspace/i).length).toBeGreaterThan(0);
  });

  it("renders the loading state when organizationLoading is true", () => {
    const controller = buildController({
      organization: null,
      organizationLoading: true,
    }) as unknown as OrganizationPageController;
    render(<OrganizationSSOPageView controller={controller} />);
    expect(screen.getByText(/Loading workspace/i)).toBeInTheDocument();
  });

  it("renders the empty-state when there is no workspace, no invitations, and no loading", () => {
    const controller = buildController({
      organization: null,
      organizationLoading: false,
      needsWorkspace: false,
      hasPendingInvitations: false,
    }) as unknown as OrganizationPageController;
    render(<OrganizationSSOPageView controller={controller} />);
    expect(screen.getAllByText(/workspace/i).length).toBeGreaterThan(0);
  });
});
