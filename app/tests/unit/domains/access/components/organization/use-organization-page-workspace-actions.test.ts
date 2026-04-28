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
});
