// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  buildController,
  buildSsoController,
} from "../../../../../helpers/access/organization-workspace-page-view-test-bed";
import { OrganizationSSOPageView } from "@/domains/access/components/organization/organization-sso-page-view";

const mocks = vi.hoisted(() => ({
  deleteWorkspaceSCIMProviderConnection: vi.fn(),
  generateWorkspaceSCIMToken: vi.fn(),
  loadWorkspaceSCIMSetup: vi.fn(),
}));

vi.mock("@/domains/access/scim.functions", () => ({
  deleteWorkspaceSCIMProviderConnection: mocks.deleteWorkspaceSCIMProviderConnection,
  generateWorkspaceSCIMToken: mocks.generateWorkspaceSCIMToken,
  loadWorkspaceSCIMSetup: mocks.loadWorkspaceSCIMSetup,
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirm: () => Promise.resolve(true),
  }),
}));

describe("OrganizationSSOPageView", () => {
  afterEach(() => {
    cleanup();
    mocks.deleteWorkspaceSCIMProviderConnection.mockReset();
    mocks.generateWorkspaceSCIMToken.mockReset();
    mocks.loadWorkspaceSCIMSetup.mockReset();
  });

  it("renders the header and basic structure", () => {
    const controller = buildSsoController();
    render(<OrganizationSSOPageView controller={controller} />);
    expect(screen.getByText("Enterprise SSO setup")).toBeInTheDocument();
    expect(screen.getAllByText(/Configure enterprise sign-in/i).length).toBeGreaterThan(0);
    const settingsNav = screen.getByRole("navigation", { name: "Organization settings" });
    expect(settingsNav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute(
      "href",
      "/organization",
    );
    expect(screen.getByRole("link", { name: "Enterprise sign-in" })).toHaveAttribute(
      "href",
      "/organization/sso",
    );
  });

  it("renders SCIM setup for Team workspaces with SCIM capability", async () => {
    mocks.loadWorkspaceSCIMSetup.mockResolvedValue({
      defaultProviderId: "atlas-scim",
      providers: [
        {
          id: "conn_1",
          organizationId: "org_1",
          providerId: "google-workspace",
        },
      ],
      scimBaseUrl: "https://atlas.test/api/auth/scim/v2",
      serviceProviderConfigUrl: "https://atlas.test/api/auth/scim/v2/ServiceProviderConfig",
      usersUrl: "https://atlas.test/api/auth/scim/v2/Users",
    });
    const controller = buildSsoController({
      session: {
        user: { id: "user_1" },
        workspace: {
          resolvedCapabilities: {
            capabilities: ["research.run", "workspace.shared", "auth.sso", "auth.scim"],
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
    });
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <OrganizationSSOPageView controller={controller} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("SCIM provisioning")).toBeInTheDocument();
    expect(
      await screen.findByDisplayValue("https://atlas.test/api/auth/scim/v2"),
    ).toBeInTheDocument();
    expect(await screen.findByDisplayValue("atlas-scim")).toBeInTheDocument();
    expect(await screen.findByText("google-workspace")).toBeInTheDocument();
  });

  it("shows team requirement message for personal workspaces", () => {
    const controller = buildSsoController({
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
    });
    render(<OrganizationSSOPageView controller={controller} />);
    expect(
      screen.getByText(
        /Enterprise SSO configuration is not available for your current workspace plan/i,
      ),
    ).toBeInTheDocument();
  });

  it("renders the auth-disabled headline only when canConfigureSSO is false", () => {
    const controller = buildSsoController({
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
    });
    render(<OrganizationSSOPageView controller={controller} />);
    expect(
      screen.getByText(
        /Enterprise SSO configuration is not available for your current workspace plan/i,
      ),
    ).toBeInTheDocument();
  });

  it("renders the workspace switcher when the operator can switch", () => {
    const controller = buildSsoController({
      canSwitchOrganizations: true,
      memberships: [
        { id: "org_1", name: "Atlas", slug: "atlas", workspaceType: "team", role: "owner" },
        { id: "org_2", name: "Other", slug: "other", workspaceType: "team", role: "member" },
      ],
      selectedOrganizationId: "org_1",
      selectWorkspacePending: false,
      onSelectWorkspace: vi.fn(),
    });
    render(<OrganizationSSOPageView controller={controller} />);
    expect(screen.getByText(/Other/)).toBeInTheDocument();
  });

  it("renders the pending invitations section when invitations exist", () => {
    const controller = buildSsoController({
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
    });
    render(<OrganizationSSOPageView controller={controller} />);
    expect(screen.getAllByText(/Atlas Future/).length).toBeGreaterThan(0);
  });

  it("renders the workspace creation form when needsWorkspace is true", () => {
    const controller = buildSsoController({
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
    });
    render(<OrganizationSSOPageView controller={controller} />);
    expect(screen.getAllByText(/Workspace/i).length).toBeGreaterThan(0);
  });

  it("renders the loading state when organizationLoading is true", () => {
    const controller = buildSsoController({
      organization: null,
      organizationLoading: true,
    });
    render(<OrganizationSSOPageView controller={controller} />);
    expect(screen.getByText(/Loading workspace/i)).toBeInTheDocument();
  });

  it("renders the empty-state when there is no workspace, no invitations, and no loading", () => {
    const controller = buildSsoController({
      organization: null,
      organizationLoading: false,
      needsWorkspace: false,
      hasPendingInvitations: false,
    });
    render(<OrganizationSSOPageView controller={controller} />);
    expect(screen.getAllByText(/workspace/i).length).toBeGreaterThan(0);
  });

  it("forwards workspace switching, invitation decisions, and creation submits through the controller", () => {
    const onSelectWorkspace = vi.fn();
    const onInvitationDecision = vi.fn();
    const onCreateWorkspace = vi.fn();
    const onUpdateWorkspaceName = vi.fn();

    // 1) Workspace switcher: rendered via canSwitchOrganizations.
    const switcherController = buildSsoController({
      canSwitchOrganizations: true,
      memberships: [
        { id: "org_1", name: "Atlas", slug: "atlas", workspaceType: "team", role: "owner" },
        { id: "org_2", name: "Other", slug: "other", workspaceType: "team", role: "member" },
      ],
      selectedOrganizationId: "org_1",
      selectWorkspacePending: false,
      onSelectWorkspace,
    });
    const switcherView = render(<OrganizationSSOPageView controller={switcherController} />);
    const switcherSelect = switcherView.container.querySelector("select");
    if (!switcherSelect) throw new Error("Expected the workspace switcher select");
    fireEvent.change(switcherSelect, { target: { value: "org_2" } });
    expect(onSelectWorkspace).toHaveBeenCalledWith("org_2");
    cleanup();

    // 2) Pending invitations: clicking Accept dispatches the controller.
    const pendingController = buildSsoController({
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
      onInvitationDecision,
    });
    render(<OrganizationSSOPageView controller={pendingController} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onInvitationDecision).toHaveBeenCalledWith("inv_1", "accept");
    cleanup();

    // 3) Workspace creation form submit dispatches through the controller.
    const creationController = buildSsoController({
      needsWorkspace: true,
      organization: null,
      createWorkspacePending: false,
      workspaceDelegatedEmail: "",
      workspaceDomain: "",
      workspaceName: "Atlas",
      workspaceSlug: "atlas",
      workspaceType: "team",
      setWorkspaceDelegatedEmail: vi.fn(),
      setWorkspaceDomain: vi.fn(),
      onUpdateWorkspaceName,
      onUpdateWorkspaceSlug: vi.fn(),
      onCreateWorkspace,
      onUpdateWorkspaceType: vi.fn(),
    });
    const creationView = render(<OrganizationSSOPageView controller={creationController} />);
    const form = creationView.container.querySelector("form");
    if (!form) throw new Error("Expected workspace creation form");
    fireEvent.submit(form);
    expect(onCreateWorkspace).toHaveBeenCalled();
  });

  it("falls back to the auth-disabled headline when the session is missing", () => {
    const controller = buildController({ session: null });
    render(<OrganizationSSOPageView controller={controller} />);
    expect(
      screen.getByText(
        /Enterprise SSO configuration is not available for your current workspace plan/i,
      ),
    ).toBeInTheDocument();
  });

  it("renders the team-required panel for non-team workspaces with auth.sso capability", () => {
    const controller = buildSsoController({
      canUseTeamFeatures: false,
      // canConfigureSSO is true via auth.sso, so the early return is skipped.
    });
    render(<OrganizationSSOPageView controller={controller} />);
    expect(
      screen.getByText(/Enterprise SSO is available only for team workspaces/i),
    ).toBeInTheDocument();
  });
});
