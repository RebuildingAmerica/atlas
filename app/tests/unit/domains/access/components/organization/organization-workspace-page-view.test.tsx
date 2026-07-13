// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { buildController } from "../../../../../helpers/access/organization-workspace-page-view-test-bed";
import { OrganizationWorkspacePageView } from "@/domains/access/components/organization/organization-workspace-page-view";

describe("OrganizationWorkspacePageView", () => {
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

  it("passes organization identity access to every team member for delegated resolution", () => {
    const { rerender } = render(<OrganizationWorkspacePageView controller={buildController()} />);
    expect(screen.getByText("Organization ATProto identity")).toHaveAttribute(
      "data-can-manage-organization",
      "true",
    );

    rerender(
      <OrganizationWorkspacePageView
        controller={buildController({ canManageOrganization: false })}
      />,
    );
    expect(screen.getByText("Organization ATProto identity")).toHaveAttribute(
      "data-can-manage-organization",
      "false",
    );
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
});
