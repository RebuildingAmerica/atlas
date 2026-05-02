// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrganizationPageWorkspaceActions } from "@/domains/access/components/organization/use-organization-page-workspace-actions";
import type { OrganizationPageForms } from "@/domains/access/components/organization/use-organization-page-forms";

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  createWorkspace: vi.fn(),
  setActiveWorkspace: vi.fn(),
  updateWorkspaceProfile: vi.fn(),
  inviteWorkspaceMember: vi.fn(),
  cancelWorkspaceInvitation: vi.fn(),
  acceptWorkspaceInvitation: vi.fn(),
  rejectWorkspaceInvitation: vi.fn(),
  updateWorkspaceMemberRole: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  leaveWorkspace: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation,
}));

vi.mock("@/domains/access/organizations.functions", () => ({
  createWorkspace: mocks.createWorkspace,
  setActiveWorkspace: mocks.setActiveWorkspace,
  updateWorkspaceProfile: mocks.updateWorkspaceProfile,
  inviteWorkspaceMember: mocks.inviteWorkspaceMember,
  cancelWorkspaceInvitation: mocks.cancelWorkspaceInvitation,
  acceptWorkspaceInvitation: mocks.acceptWorkspaceInvitation,
  rejectWorkspaceInvitation: mocks.rejectWorkspaceInvitation,
  updateWorkspaceMemberRole: mocks.updateWorkspaceMemberRole,
  removeWorkspaceMember: mocks.removeWorkspaceMember,
  leaveWorkspace: mocks.leaveWorkspace,
}));

describe("useOrganizationPageWorkspaceActions", () => {
  const feedback = {
    setErrorMessage: vi.fn(),
    setFlashMessage: vi.fn(),
  };
  const forms = {
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
    setSelectedOrganizationId: vi.fn(),
    profileName: "Atlas",
    profileSlug: "atlas",
    inviteEmail: "user@atlas.test",
    inviteRole: "member",
    setInviteEmail: vi.fn(),
    setInviteRole: vi.fn(),
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
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onCreateWorkspace({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent<HTMLFormElement>);
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
        forms: forms as unknown as OrganizationPageForms,
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
        forms: forms as unknown as OrganizationPageForms,
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
        forms: forms as unknown as OrganizationPageForms,
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
        forms: forms as unknown as OrganizationPageForms,
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
    const teamForms = {
      ...forms,
      workspaceDomain: "atlas.test",
      workspaceDelegatedEmail: "owner@atlas.test",
      workspaceType: "team",
    };

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: null,
        feedback,
        forms: teamForms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onCreateWorkspace({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent<HTMLFormElement>);
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
    const soloForms = {
      ...forms,
      workspaceDomain: "atlas.test",
      workspaceDelegatedEmail: "owner@atlas.test",
      workspaceType: "individual",
    };

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: null,
        feedback,
        forms: soloForms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onCreateWorkspace({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent<HTMLFormElement>);
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
        forms: forms as unknown as OrganizationPageForms,
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
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onSelectWorkspace("org_2");
    });

    expect(forms.setSelectedOrganizationId).toHaveBeenLastCalledWith("");
  });

  it("saves a profile update", async () => {
    mocks.updateWorkspaceProfile.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onProfileSave({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent<HTMLFormElement>);
    });

    expect(mocks.updateWorkspaceProfile).toHaveBeenCalledWith({
      data: { name: "Atlas", slug: "atlas" },
    });
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Workspace details updated.");
  });

  it("invites a workspace member and clears the form afterwards", async () => {
    mocks.inviteWorkspaceMember.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onInviteMember({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent<HTMLFormElement>);
    });

    expect(mocks.inviteWorkspaceMember).toHaveBeenCalledWith({
      data: { email: "user@atlas.test", role: "member" },
    });
    expect(forms.setInviteEmail).toHaveBeenCalledWith("");
    expect(forms.setInviteRole).toHaveBeenCalledWith("member");
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Invitation sent.");
  });

  it("changes a workspace member role", async () => {
    mocks.updateWorkspaceMemberRole.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onUpdateMemberRole("mem_1", "admin");
    });

    expect(mocks.updateWorkspaceMemberRole).toHaveBeenCalledWith({
      data: { memberId: "mem_1", role: "admin" },
    });
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Member role updated.");
  });

  it("removes a workspace member", async () => {
    mocks.removeWorkspaceMember.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onRemoveMember("mem_1");
    });

    expect(mocks.removeWorkspaceMember).toHaveBeenCalledWith({
      data: { memberIdOrEmail: "mem_1" },
    });
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Member removed.");
  });

  it("leaves a workspace", async () => {
    mocks.leaveWorkspace.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onLeaveWorkspace();
    });

    expect(mocks.leaveWorkspace).toHaveBeenCalled();
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("You left the workspace.");
  });
});
