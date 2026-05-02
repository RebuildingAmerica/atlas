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
      members: [],
      invitations: [],
      metadata: { workspaceType: "team" },
      capabilities: { canUseTeamFeatures: true },
      role: "owner",
      workspaceType: "team",
      sso: { providers: [] },
    },
    activeWorkspace: { id: "org_1", name: "Atlas" },
    session: {
      user: { id: "user_1" },
      workspace: {
        resolvedCapabilities: {
          capabilities: ["research.run", "workspace.shared"],
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
    workspaceDelegatedEmail: "",
    workspaceDomain: "",
    workspaceName: "Atlas",
    workspaceSlug: "atlas",
    workspaceType: "team",
    setWorkspaceDelegatedEmail: vi.fn(),
    setWorkspaceDomain: vi.fn(),
    canManageOrganization: true,
    profileName: "Atlas",
    profileSlug: "atlas",
    inviteEmail: "",
    inviteRole: "member",
    onUpdateWorkspaceName: vi.fn(),
    onUpdateWorkspaceSlug: vi.fn(),
    onUpdateWorkspaceType: vi.fn(),
    onCreateWorkspace: vi.fn(),
    setProfileName: vi.fn(),
    setProfileSlug: vi.fn(),
    onProfileSave: vi.fn(),
    onLeaveWorkspace: vi.fn(),
    onSelectWorkspace: vi.fn(),
    onInvitationDecision: vi.fn(),
    setInviteEmail: vi.fn(),
    onUpdateInviteRole: vi.fn(),
    onInviteMember: vi.fn(),
    onRemoveMember: vi.fn(),
    onUpdateMemberRole: vi.fn(),
    ...overrides,
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the header and basic structure", () => {
    const controller = buildController() as unknown as OrganizationPageController;
    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Atlas" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Atlas")).toBeInTheDocument();
  });

  it("shows loading state when requested", () => {
    const controller = buildController({
      organizationLoading: true,
      organization: null,
    }) as unknown as OrganizationPageController;
    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(screen.getByText(/Loading workspace details/i)).toBeInTheDocument();
  });

  it("shows empty state when no workspace exists", () => {
    const controller = buildController({
      needsWorkspace: false,
      hasPendingInvitations: false,
      organization: null,
    }) as unknown as OrganizationPageController;
    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(screen.getByText(/No active workspace/i)).toBeInTheDocument();
  });

  it("renders workspace creation section when needed", () => {
    const controller = buildController({
      needsWorkspace: true,
      organization: null,
    }) as unknown as OrganizationPageController;
    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(screen.getByText(/Create your workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/Create workspace/i)).toBeInTheDocument();
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
    }) as unknown as OrganizationPageController;

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
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
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
    }) as unknown as OrganizationPageController;

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
    }) as unknown as OrganizationPageController;

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
    }) as unknown as OrganizationPageController;
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
    }) as unknown as OrganizationPageController;

    const view = render(<OrganizationWorkspacePageView controller={controller} />);
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Expected workspace creation form");
    fireEvent.submit(form);
    expect(onCreateWorkspace).toHaveBeenCalled();
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
    }) as unknown as OrganizationPageController;

    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(screen.getByRole("heading", { level: 1, name: "Solo" })).toBeInTheDocument();
    expect(
      screen.queryByText(/Manage your shared workspace, team members, and invitations/i),
    ).not.toBeInTheDocument();
  });
});
