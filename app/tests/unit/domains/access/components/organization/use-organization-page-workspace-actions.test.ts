// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrganizationPageWorkspaceActions } from "@/domains/access/components/organization/use-organization-page-workspace-actions";
import type { OrganizationPageForms } from "@/domains/access/components/organization/use-organization-page-forms";

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  createWorkspace: vi.fn(),
  convertWorkspaceToTeam: vi.fn(),
  setActiveWorkspace: vi.fn(),
  updateWorkspaceProfile: vi.fn(),
  inviteWorkspaceMember: vi.fn(),
  cancelWorkspaceInvitation: vi.fn(),
  acceptWorkspaceInvitation: vi.fn(),
  rejectWorkspaceInvitation: vi.fn(),
  resendWorkspaceInvitation: vi.fn(),
  updateWorkspaceMemberRole: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  leaveWorkspace: vi.fn(),
  updateWorkspaceDirectoryConfig: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation,
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/organizations.functions", () => ({
  createWorkspace: mocks.createWorkspace,
  convertWorkspaceToTeam: mocks.convertWorkspaceToTeam,
  setActiveWorkspace: mocks.setActiveWorkspace,
  updateWorkspaceProfile: mocks.updateWorkspaceProfile,
  inviteWorkspaceMember: mocks.inviteWorkspaceMember,
  cancelWorkspaceInvitation: mocks.cancelWorkspaceInvitation,
  acceptWorkspaceInvitation: mocks.acceptWorkspaceInvitation,
  rejectWorkspaceInvitation: mocks.rejectWorkspaceInvitation,
  resendWorkspaceInvitation: mocks.resendWorkspaceInvitation,
  updateWorkspaceMemberRole: mocks.updateWorkspaceMemberRole,
  removeWorkspaceMember: mocks.removeWorkspaceMember,
  leaveWorkspace: mocks.leaveWorkspace,
}));

vi.mock("@/domains/workspace/server/directory-config", () => ({
  updateWorkspaceDirectoryConfig: mocks.updateWorkspaceDirectoryConfig,
}));

describe("useOrganizationPageWorkspaceActions", () => {
  const feedback = {
    setErrorMessage: vi.fn(),
    setFlashMessage: vi.fn(),
  };
  const forms: OrganizationPageForms = {
    directoryCorrectionPolicy: "",
    directoryEntryTypes: "",
    directoryGeographyLabels: "",
    directoryIssueAreaIds: "",
    directoryMethodologySummary: "",
    directoryReviewPolicy: "",
    directorySourcePolicy: "",
    directorySponsorLabel: "",
    directoryTitle: "",
    inviteEmail: "user@atlas.test",
    inviteRole: "member",
    oidcSetupForm: {
      clientId: "",
      clientSecret: "",
      domain: "",
      providerId: "",
      setAsPrimary: false,
    },
    profileName: "Atlas",
    profileSlug: "atlas",
    samlSetupForm: {
      certificate: "",
      domain: "",
      entryPoint: "",
      issuer: "",
      providerId: "",
      setAsPrimary: true,
    },
    selectedOrganizationId: "",
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
    setSelectedOrganizationId: vi.fn(),
    workspaceDelegatedEmail: "",
    workspaceDomain: "",
    workspaceName: "New",
    workspaceSlug: "new",
    workspaceType: "team",
    setWorkspaceDelegatedEmail: vi.fn(),
    setWorkspaceDomain: vi.fn(),
    setWorkspaceName: vi.fn(),
    setWorkspaceSlug: vi.fn(),
    setWorkspaceType: vi.fn(),
    onUpdateInviteRole: vi.fn(),
    onUpdateWorkspaceName: vi.fn(),
    onUpdateWorkspaceSlug: vi.fn(),
    onUpdateWorkspaceType: vi.fn(),
  };
  const refreshWorkspaceData = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useMutation.mockImplementation(
      ({ mutationFn }: { mutationFn: (args: unknown) => unknown }) => ({
        mutateAsync: vi.fn().mockImplementation((args: unknown) => mutationFn(args)),
        isPending: false,
      }),
    );
  });

  it("handles workspace creation", async () => {
    mocks.createWorkspace.mockResolvedValue({ id: "org_new" });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: null,
        feedback,
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onCreateWorkspace({ preventDefault: vi.fn() });
    });

    expect(mocks.createWorkspace).toHaveBeenCalled();
    expect(forms.setWorkspaceName).toHaveBeenCalledWith("");
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Workspace created.");
  });

  it("handles workspace switching", async () => {
    mocks.setActiveWorkspace.mockResolvedValue({ id: "org_2" });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onSelectWorkspace("org_2");
    });

    expect(mocks.setActiveWorkspace).toHaveBeenCalledWith({ data: { organizationId: "org_2" } });
    expect(forms.setSelectedOrganizationId).toHaveBeenCalledWith("org_2");
  });

  it("handles invitation decisions", async () => {
    mocks.acceptWorkspaceInvitation.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onInvitationDecision("inv_1", "accept");
    });

    expect(mocks.acceptWorkspaceInvitation).toHaveBeenCalledWith({
      data: { invitationId: "inv_1" },
    });
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Invitation accepted.");
  });

  it("rejects an invitation", async () => {
    mocks.rejectWorkspaceInvitation.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onInvitationDecision("inv_1", "reject");
    });

    expect(mocks.rejectWorkspaceInvitation).toHaveBeenCalledWith({
      data: { invitationId: "inv_1" },
    });
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Invitation declined.");
  });

  it("cancels an invitation", async () => {
    mocks.cancelWorkspaceInvitation.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onInvitationDecision("inv_1", "cancel");
    });

    expect(mocks.cancelWorkspaceInvitation).toHaveBeenCalledWith({
      data: { invitationId: "inv_1" },
    });
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Invitation canceled.");
  });

  it("includes domain and delegated email when creating a team workspace", async () => {
    mocks.createWorkspace.mockResolvedValue({ id: "org_team" });
    const teamForms: OrganizationPageForms = {
      ...forms,
      workspaceDomain: "atlas.test",
      workspaceDelegatedEmail: "owner@atlas.test",
      workspaceType: "team",
    };

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: null,
        feedback,
        forms: teamForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onCreateWorkspace({ preventDefault: vi.fn() });
    });

    expect(mocks.createWorkspace).toHaveBeenCalledWith({
      data: {
        name: "New",
        slug: "new",
        workspaceType: "team",
        workspaceDomain: "atlas.test",
        delegatedAdminEmail: "owner@atlas.test",
      },
    });
    expect(feedback.setFlashMessage).toHaveBeenCalledWith(
      "Workspace created. Admin invite sent to your handoff contact.",
    );
  });

  it("does not pass domain or delegated email for individual workspaces", async () => {
    mocks.createWorkspace.mockResolvedValue({ id: "org_solo" });
    const soloForms: OrganizationPageForms = {
      ...forms,
      workspaceDomain: "atlas.test",
      workspaceDelegatedEmail: "owner@atlas.test",
      workspaceType: "individual",
    };

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: null,
        feedback,
        forms: soloForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onCreateWorkspace({ preventDefault: vi.fn() });
    });

    expect(mocks.createWorkspace).toHaveBeenCalledWith({
      data: { name: "New", slug: "new", workspaceType: "individual" },
    });
  });

  it("rolls back the selected organization when a workspace switch fails", async () => {
    const error = new Error("network");
    mocks.setActiveWorkspace.mockRejectedValue(error);

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onSelectWorkspace("org_2");
    });

    // First call sets to the requested org, last call rolls back to the active.
    expect(forms.setSelectedOrganizationId).toHaveBeenCalledWith("org_2");
    expect(forms.setSelectedOrganizationId).toHaveBeenLastCalledWith("org_1");
  });

  it("falls back to an empty selected organization id when no active workspace exists during rollback", async () => {
    mocks.setActiveWorkspace.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: null,
        feedback,
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onSelectWorkspace("org_2");
    });

    expect(forms.setSelectedOrganizationId).toHaveBeenLastCalledWith("");
  });
});
