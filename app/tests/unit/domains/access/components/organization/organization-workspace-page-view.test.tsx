// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { OrganizationPageController } from "@/domains/access/components/organization/organization-page-controller";
import { OrganizationWorkspacePageView } from "@/domains/access/components/organization/organization-workspace-page-view";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({}),
}));

vi.mock("@/platform/ui/toast", () => ({
  useToast: () => ({
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("OrganizationWorkspacePageView", () => {
  const buildController = (overrides = {}): OrganizationPageController => {
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

  it("renders local organization settings navigation", () => {
    render(<OrganizationWorkspacePageView controller={buildController()} />);

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

  afterEach(() => {
    cleanup();
  });

  it("renders the header and basic structure", () => {
    const controller = buildController();
    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Atlas" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Atlas")).toBeInTheDocument();
  });

  it("shows loading state when requested", () => {
    const controller = buildController({
      organizationLoading: true,
      organization: null,
    });
    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(screen.getByText(/Loading workspace details/i)).toBeInTheDocument();
  });

  it("shows empty state when no workspace exists", () => {
    const controller = buildController({
      needsWorkspace: false,
      hasPendingInvitations: false,
      organization: null,
    });
    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(screen.getByText(/No active workspace/i)).toBeInTheDocument();
  });

  it("renders workspace creation section when needed", () => {
    const controller = buildController({
      needsWorkspace: true,
      organization: null,
    });
    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(screen.getByText(/Create your workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/Create workspace/i)).toBeInTheDocument();
  });

  it("renders public directory settings for directory-capable workspaces", () => {
    const controller = buildController({
      canUsePublicDirectories: true,
      directoryCorrectionPolicy: "Readers can send corrections.",
      directoryEntryTypes: "organization",
      directoryGeographyLabels: "Detroit, MI",
      directoryIssueAreaIds: "housing_affordability",
      directoryMethodologySummary: "Reviewed records with linked public sources.",
      directoryReviewPolicy: "Records are checked before publication.",
      directorySourcePolicy: "Every listing includes a public source.",
      directorySponsorLabel: "Supported by Detroit Housing Fund",
      directoryTitle: "Detroit tenant power directory",
    });

    render(<OrganizationWorkspacePageView controller={controller} />);

    expect(screen.getByRole("heading", { name: "Public directory" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Detroit tenant power directory")).toBeInTheDocument();
  });

  it("forwards inline handlers (workspace switching, profile save, leaving the workspace, member removal, role change)", async () => {
    const onSelectWorkspace = vi.fn();
    const onProfileSave = vi.fn();
    const onLeaveWorkspace = vi.fn().mockResolvedValue(undefined);
    const onRemoveMember = vi.fn();
    const onUpdateMemberRole = vi.fn();

    const controller = buildController({
      canSwitchOrganizations: true,
      memberships: [
        { id: "org_1", name: "Atlas", slug: "atlas", workspaceType: "team", role: "owner" },
        { id: "org_2", name: "Other", slug: "other", workspaceType: "team", role: "member" },
      ],
      selectedOrganizationId: "org_1",
      selectWorkspacePending: false,
      onSelectWorkspace,
      onProfileSave,
      onLeaveWorkspace,
      organization: {
        id: "org_1",
        name: "Atlas",
        slug: "atlas",
        members: [
          {
            id: "mem_self",
            userId: "user_1",
            name: "Self",
            email: "self@atlas.test",
            role: "member",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "mem_2",
            userId: "user_2",
            name: "Teammate",
            email: "teammate@atlas.test",
            role: "member",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        invitations: [],
        metadata: { workspaceType: "team" },
        capabilities: { canUseTeamFeatures: true },
        role: "member",
        workspaceType: "team",
        sso: { providers: [] },
      },
      onRemoveMember,
      onUpdateMemberRole,
    });

    const view = render(<OrganizationWorkspacePageView controller={controller} />);

    // Workspace switcher.
    const switcherSelect = view.container.querySelector("select");
    if (!switcherSelect) throw new Error("Expected switcher select element");
    fireEvent.change(switcherSelect, { target: { value: "org_2" } });
    expect(onSelectWorkspace).toHaveBeenCalledWith("org_2");

    // Profile save submit.
    const forms = view.container.querySelectorAll("form");
    const profileForm = forms[0];
    if (!profileForm) throw new Error("Expected at least one form (profile)");
    fireEvent.submit(profileForm);
    expect(onProfileSave).toHaveBeenCalled();

    // Leave workspace button.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Leave workspace/i }));
      await Promise.resolve();
    });
    expect(onLeaveWorkspace).toHaveBeenCalled();

    // Member role change.
    const roleSelect = screen.getByLabelText(/Role for teammate@atlas\.test/i);
    fireEvent.change(roleSelect, { target: { value: "admin" } });
    expect(onUpdateMemberRole).toHaveBeenCalledWith("mem_2", "admin");

    // Member removal.
    fireEvent.click(screen.getByRole("button", { name: "Remove Teammate" }));
    expect(onRemoveMember).toHaveBeenCalledWith("mem_2");
  });

  it("forwards invitation cancellation to the controller", () => {
    const onInvitationDecision = vi.fn();
    const controller = buildController({
      onInvitationDecision,
      organization: {
        id: "org_1",
        name: "Atlas",
        slug: "atlas",
        members: [],
        invitations: [
          {
            id: "inv_1",
            email: "pending@atlas.test",
            role: "admin",
            status: "pending",
            createdAt: "2026-04-01T00:00:00.000Z",
            expiresAt: "2026-05-01T00:00:00.000Z",
          },
        ],
        metadata: { workspaceType: "team" },
        capabilities: { canUseTeamFeatures: true },
        role: "owner",
        workspaceType: "team",
        sso: { providers: [] },
      },
      pendingInvitationMutationPending: false,
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onInvitationDecision).toHaveBeenCalledWith("inv_1", "cancel");
  });

  it("renders the team invitations form and forwards its submit", () => {
    const onInviteMember = vi.fn();
    const controller = buildController({
      onInviteMember,
      organization: {
        id: "org_1",
        name: "Atlas",
        slug: "atlas",
        members: [],
        invitations: [],
        metadata: { workspaceType: "team" },
        capabilities: { canUseTeamFeatures: true },
        role: "owner",
        workspaceType: "team",
        sso: { providers: [] },
      },
      inviteEmail: "new@atlas.test",
      inviteRole: "member",
      invitePending: false,
      pendingInvitationMutationPending: false,
    });

    const view = render(<OrganizationWorkspacePageView controller={controller} />);
    const forms = view.container.querySelectorAll("form");
    const inviteForm = forms[forms.length - 1];
    if (!inviteForm) throw new Error("Expected invite form");
    fireEvent.submit(inviteForm);
    expect(onInviteMember).toHaveBeenCalled();
  });

  it("renders the pending invitations section and dispatches decision callbacks", () => {
    const onInvitationDecision = vi.fn();
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
      onInvitationDecision,
    });
    render(<OrganizationWorkspacePageView controller={controller} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onInvitationDecision).toHaveBeenCalledWith("inv_1", "accept");
  });

  it("renders the workspace creation form and dispatches name/slug edits and submit", () => {
    const onUpdateWorkspaceName = vi.fn();
    const onUpdateWorkspaceSlug = vi.fn();
    const onUpdateWorkspaceType = vi.fn();
    const onCreateWorkspace = vi.fn();

    const controller = buildController({
      needsWorkspace: true,
      organization: null,
      createWorkspacePending: false,
      workspaceDelegatedEmail: "",
      workspaceDomain: "",
      workspaceName: "",
      workspaceSlug: "",
      workspaceType: "team",
      setWorkspaceDelegatedEmail: vi.fn(),
      setWorkspaceDomain: vi.fn(),
      onUpdateWorkspaceName,
      onUpdateWorkspaceSlug,
      onUpdateWorkspaceType,
      onCreateWorkspace,
    });

    const view = render(<OrganizationWorkspacePageView controller={controller} />);
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Expected workspace creation form");
    fireEvent.submit(form);
    expect(onCreateWorkspace).toHaveBeenCalled();
  });

  it("falls back to a generic title when the organization and active workspace lack a name", () => {
    const controller = buildController({
      organization: {
        id: "org_1",
        name: null,
        slug: "atlas",
        members: [],
        invitations: [],
        metadata: { workspaceType: "team" },
        capabilities: { canUseTeamFeatures: true },
        role: "owner",
        workspaceType: "team",
        sso: { providers: [] },
      },
      activeWorkspace: null,
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Workspace management" }),
    ).toBeInTheDocument();
  });

  it("treats invite permissions as unavailable when the controller session is null", () => {
    const controller = buildController({
      session: null,
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    // No invite form should render when the session is missing.
    expect(screen.queryByText(/Invite people to your workspace/i)).not.toBeInTheDocument();
  });

  it("renders the personal-workspace heading without team sections when team features are unavailable", () => {
    const controller = buildController({
      canUseTeamFeatures: false,
      organization: {
        id: "org_1",
        name: "Solo",
        slug: "solo",
        members: [],
        invitations: [],
        metadata: { workspaceType: "individual" },
        capabilities: { canUseTeamFeatures: false },
        role: "owner",
        workspaceType: "individual",
        sso: { providers: [] },
      },
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(screen.getByRole("heading", { level: 1, name: "Solo" })).toBeInTheDocument();
    expect(
      screen.queryByText(/Manage your shared workspace, team members, and invitations/i),
    ).not.toBeInTheDocument();
  });

  it("renders the seats & cost section when a team seat-cost summary is loaded", () => {
    const controller = buildController({
      teamSeatCostSummary: {
        interval: "monthly",
        seatsUsed: 1,
        maxSeats: 50,
        additionalSeats: 0,
        baseCents: 2500,
        perSeatCents: 800,
        additionalSeatsCents: 0,
        totalCents: 2500,
      },
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(screen.getByText(/Seats & cost/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 50 seats used/i)).toBeInTheDocument();
  });

  it("shows enterprise package access and limits to workspace admins", () => {
    const controller = buildController({
      session: {
        user: { id: "user_1" },
        workspace: {
          activeProducts: ["atlas_field_intelligence"],
          resolvedCapabilities: {
            capabilities: [
              "research.run",
              "research.unlimited",
              "workspace.export",
              "workspace.shared",
              "monitoring.watchlists",
              "coverage.targets",
              "integrations.slack",
            ],
            limits: {
              research_runs_per_month: null,
              max_shortlists: null,
              max_shortlist_entries: null,
              max_api_keys: null,
              api_requests_per_day: 10000,
              public_api_requests_per_hour: null,
              max_members: 25,
            },
          },
        },
      },
    });

    render(<OrganizationWorkspacePageView controller={controller} />);

    expect(screen.getByRole("heading", { level: 2, name: "Package access" })).toBeInTheDocument();
    expect(screen.getByText("Atlas Field Intelligence")).toBeInTheDocument();
    expect(screen.getByText("25 members")).toBeInTheDocument();
    expect(screen.getByText("10,000 API requests/day")).toBeInTheDocument();
    expect(screen.getByText("Exports")).toBeInTheDocument();
    expect(screen.getByText("Monitoring")).toBeInTheDocument();
    expect(screen.getByText("Coverage targets")).toBeInTheDocument();
    expect(screen.getByText("SSO")).toBeInTheDocument();
    expect(screen.getByText("Not included")).toBeInTheDocument();
  });

  it("shows renewal proof to workspace admins", () => {
    const controller = buildController({
      usageSummary: {
        event_counts: { brief_opened: 2 },
        org_id: "org_1",
        renewal_signals: {
          briefs_used: 2,
          coverage_gaps_closed: 1,
          integrations_used: 0,
          public_records_improved: 3,
          team_workflow_actions: 4,
        },
        total_events: 10,
      },
      usageAuditLog: {
        data_boundary: {
          metadata_included: false,
          session_replay_included: false,
          statement:
            "The audit log shows timestamped workspace usage events without private metadata or behavioral session replay.",
        },
        items: [
          {
            actor_id: "user_1",
            created_at: "2026-07-03T12:00:00.000Z",
            event_type: "api_call",
            id: "event_1",
            org_id: "org_1",
            resource_id: "GET /api/profiles/{slug}",
            resource_type: "api",
          },
        ],
        limit: 10,
        offset: 0,
        org_id: "org_1",
        total: 1,
      },
      integrationMonitoring: {
        api_calls: 2,
        data_boundary: {
          request_metadata_included: false,
          session_replay_included: false,
          statement:
            "Workspace integration activity records counts, surfaces, paths, and last-seen times without request metadata or behavioral session replay.",
        },
        last_seen_at: "2026-07-03T12:00:00.000Z",
        mcp_calls: 1,
        org_id: "org_1",
        top_resources: [
          {
            last_seen_at: "2026-07-03T12:00:00.000Z",
            resource_id: "/mcp",
            surface: "mcp",
            total_calls: 1,
          },
        ],
        total_calls: 3,
      },
    });

    render(<OrganizationWorkspacePageView controller={controller} />);

    expect(screen.getByRole("heading", { level: 2, name: "Renewal proof" })).toBeInTheDocument();
    expect(screen.getByText("Public records improved")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Access log" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Workspace integration activity" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download packet" })).toHaveAttribute(
      "href",
      "/api/orgs/org_1/usage-summary/renewal-packet?format=markdown",
    );
  });

  it("hides renewal proof from workspaces the operator cannot manage", () => {
    const controller = buildController({
      canManageOrganization: false,
      usageSummary: {
        event_counts: { brief_opened: 2 },
        org_id: "org_1",
        renewal_signals: {
          briefs_used: 2,
          coverage_gaps_closed: 1,
          integrations_used: 0,
          public_records_improved: 3,
          team_workflow_actions: 4,
        },
        total_events: 10,
      },
    });

    render(<OrganizationWorkspacePageView controller={controller} />);

    expect(
      screen.queryByRole("heading", { level: 2, name: "Renewal proof" }),
    ).not.toBeInTheDocument();
  });

  it("forwards resend requests from the invitations section to the controller", () => {
    const onResendInvitation = vi.fn();
    const controller = buildController({
      onResendInvitation,
      organization: {
        id: "org_1",
        name: "Atlas",
        slug: "atlas",
        members: [],
        invitations: [
          {
            id: "inv_1",
            email: "pending@atlas.test",
            role: "member",
            status: "pending",
            createdAt: "2026-04-01T00:00:00.000Z",
            expiresAt: "2026-05-01T00:00:00.000Z",
          },
        ],
        metadata: { workspaceType: "team" },
        capabilities: { canUseTeamFeatures: true },
        role: "owner",
        workspaceType: "team",
        sso: { providers: [] },
      },
      pendingInvitationMutationPending: false,
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    expect(onResendInvitation).toHaveBeenCalledWith("pending@atlas.test", "member");
  });

  it("shows the invite upsell instead of the form when a team lacks the shared capability", () => {
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
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(
      screen.getByText(/Subscribe to Atlas Team to invite members to this workspace/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Send invitation/i)).not.toBeInTheDocument();
  });

  it("offers an upgrade prompt on an individual workspace the operator manages", () => {
    const onUpgradeToTeam = vi.fn();
    const controller = buildController({
      canUseTeamFeatures: false,
      canManageOrganization: false,
      activeWorkspace: { id: "org_1", name: "Solo", role: "owner" },
      organization: {
        id: "org_1",
        name: "Solo",
        slug: "solo",
        members: [{ id: "mem_1", userId: "user_1", role: "owner" }],
        invitations: [],
        metadata: { workspaceType: "individual" },
        capabilities: { canUseTeamFeatures: false },
        role: "owner",
        workspaceType: "individual",
        sso: { providers: [] },
      },
      onUpgradeToTeam,
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    fireEvent.click(screen.getByRole("button", { name: /Upgrade to a team workspace/i }));
    expect(onUpgradeToTeam).toHaveBeenCalled();
  });

  it("hides the upgrade prompt on an individual workspace the operator cannot manage", () => {
    const controller = buildController({
      canUseTeamFeatures: false,
      canManageOrganization: false,
      activeWorkspace: {
        id: "org_1",
        name: "Solo",
        role: "member",
        slug: "solo",
        workspaceType: "individual",
      },
      organization: {
        id: "org_1",
        name: "Solo",
        slug: "solo",
        members: [{ id: "mem_1", userId: "user_1", role: "member" }],
        invitations: [],
        metadata: { workspaceType: "individual" },
        capabilities: { canUseTeamFeatures: false },
        role: "member",
        workspaceType: "individual",
        sso: { providers: [] },
      },
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(
      screen.queryByRole("button", { name: /Upgrade to a team workspace/i }),
    ).not.toBeInTheDocument();
  });
});
