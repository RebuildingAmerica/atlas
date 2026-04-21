// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { OrganizationPageController } from "@/domains/access/components/organization/organization-page-types";
import { OrganizationWorkspacePageView } from "@/domains/access/components/organization/organization-workspace-page-view";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({}),
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
    workspaceName: "Atlas",
    workspaceSlug: "atlas",
    workspaceType: "team",
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
    expect(screen.getByText(/Choose the workspace you want to run/i)).toBeInTheDocument();
    expect(screen.getByText(/Create workspace/i)).toBeInTheDocument();
  });
});
