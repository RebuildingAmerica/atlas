// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrganizationPageWorkspaceActions } from "@/domains/access/components/organization/use-organization-page-workspace-actions";
import type { OrganizationPageForms } from "@/domains/access/components/organization/use-organization-page-forms";

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  useNavigate: vi.fn(),
  navigate: vi.fn(),
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

vi.mock("@tanstack/react-router", () => ({
  useNavigate: mocks.useNavigate,
}));

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
    mocks.navigate.mockResolvedValue(undefined);
    mocks.useNavigate.mockReturnValue(mocks.navigate);
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

  it("saves a profile update", async () => {
    mocks.updateWorkspaceProfile.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onProfileSave({ preventDefault: vi.fn() });
    });

    expect(mocks.updateWorkspaceProfile).toHaveBeenCalledWith({
      data: { name: "Atlas", slug: "atlas" },
    });
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Workspace details updated.");
  });

  it("saves public directory settings with parsed scope fields", async () => {
    mocks.updateWorkspaceDirectoryConfig.mockResolvedValue({ org_id: "org_1" });
    const directoryForms: OrganizationPageForms = {
      ...forms,
      directoryCorrectionPolicy: "Readers can send stale facts.",
      directoryEntryTypes: "organization, person",
      directoryGeographyLabels: "Detroit, MI",
      directoryIssueAreaIds: "housing_affordability, tenant_power",
      directoryMethodologySummary: "Reviewed records with linked public sources.",
      directoryReviewPolicy: "Records are checked before publication.",
      directorySourcePolicy: "Each listing includes a public source.",
      directorySponsorLabel: "",
      directoryTitle: "Detroit tenant power directory",
    };

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms: directoryForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onDirectoryConfigSave({ preventDefault: vi.fn() });
    });

    expect(mocks.updateWorkspaceDirectoryConfig).toHaveBeenCalledWith({
      data: {
        methodology: {
          correction_path_template: "/feedback/{slug}?kind=incorrect",
          correction_policy: "Readers can send stale facts.",
          missing_context_path_template: "/feedback/{slug}?kind=missing_context",
          review_policy: "Records are checked before publication.",
          source_policy: "Each listing includes a public source.",
          summary: "Reviewed records with linked public sources.",
        },
        scope: {
          entry_types: ["organization", "person"],
          geography_labels: ["Detroit, MI"],
          issue_area_ids: ["housing_affordability", "tenant_power"],
        },
        sponsor_label: null,
        title: "Detroit tenant power directory",
      },
    });
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Directory settings updated.");
  });

  it("invites a workspace member and clears the form afterwards", async () => {
    mocks.inviteWorkspaceMember.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onInviteMember({ preventDefault: vi.fn() });
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
        forms,
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
        forms,
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
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onLeaveWorkspace();
    });

    expect(mocks.leaveWorkspace).toHaveBeenCalled();
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("You left the workspace.");
  });

  it("resends an invitation atomically without cancelling the existing one", async () => {
    mocks.resendWorkspaceInvitation.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onResendInvitation("pending@atlas.test", "admin");
    });

    expect(mocks.resendWorkspaceInvitation).toHaveBeenCalledWith({
      data: { email: "pending@atlas.test", role: "admin" },
    });
    expect(mocks.cancelWorkspaceInvitation).not.toHaveBeenCalled();
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Invitation resent.");
  });

  it("upgrades an individual workspace to a team and routes to pricing", async () => {
    mocks.convertWorkspaceToTeam.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onUpgradeToTeam();
    });

    expect(mocks.convertWorkspaceToTeam).toHaveBeenCalled();
    expect(feedback.setFlashMessage).toHaveBeenCalledWith(
      "Workspace upgraded to a team. Subscribe to Atlas Team to invite members.",
    );
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/pricing" });
  });

  it("does not route to pricing when the upgrade fails", async () => {
    mocks.convertWorkspaceToTeam.mockRejectedValue(new Error("nope"));

    const { result } = renderHook(() =>
      useOrganizationPageWorkspaceActions({
        activeWorkspaceId: "org_1",
        feedback,
        forms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onUpgradeToTeam();
    });

    expect(feedback.setErrorMessage).toHaveBeenCalledWith("nope");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
