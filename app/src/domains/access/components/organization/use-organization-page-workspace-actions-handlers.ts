import { type NavigateOptions } from "@tanstack/react-router";
import type {
  acceptWorkspaceInvitation,
  cancelWorkspaceInvitation,
  createWorkspace,
  inviteWorkspaceMember,
  rejectWorkspaceInvitation,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
  setActiveWorkspace,
  updateWorkspaceMemberRole,
  updateWorkspaceProfile,
} from "@/domains/access/organizations.functions";
import type { updateWorkspaceDirectoryConfig } from "@/domains/workspace/server/directory-config";
import type {
  OrganizationPageFormSubmitEvent,
  OrganizationPageWorkspaceActions,
} from "./use-organization-page-workspace-actions";
import type { OrganizationPageForms } from "./use-organization-page-forms";
import type { OrganizationPageMutationFeedback } from "./organization-page-mutation-helpers";
import { runOrganizationPageMutation } from "./organization-page-mutation-helpers";

interface WorkspaceMutationLike<TArgs extends readonly unknown[] = []> {
  isPending: boolean;
  mutateAsync: (...args: TArgs) => Promise<unknown>;
}

export interface OrganizationPageWorkspaceActionDependencies {
  activeWorkspaceId: string | null | undefined;
  feedback: OrganizationPageMutationFeedback;
  forms: OrganizationPageForms;
  refreshWorkspaceData: () => Promise<void>;
  navigate: (options: NavigateOptions) => Promise<void>;
  createWorkspaceMutation: WorkspaceMutationLike<Parameters<typeof createWorkspace>>;
  convertWorkspaceToTeamMutation: WorkspaceMutationLike;
  setActiveWorkspaceMutation: WorkspaceMutationLike<Parameters<typeof setActiveWorkspace>>;
  updateWorkspaceProfileMutation: WorkspaceMutationLike<Parameters<typeof updateWorkspaceProfile>>;
  updateDirectoryConfigMutation: WorkspaceMutationLike<
    Parameters<typeof updateWorkspaceDirectoryConfig>
  >;
  inviteWorkspaceMemberMutation: WorkspaceMutationLike<Parameters<typeof inviteWorkspaceMember>>;
  cancelWorkspaceInvitationMutation: WorkspaceMutationLike<
    Parameters<typeof cancelWorkspaceInvitation>
  >;
  resendWorkspaceInvitationMutation: WorkspaceMutationLike<
    Parameters<typeof resendWorkspaceInvitation>
  >;
  acceptWorkspaceInvitationMutation: WorkspaceMutationLike<
    Parameters<typeof acceptWorkspaceInvitation>
  >;
  rejectWorkspaceInvitationMutation: WorkspaceMutationLike<
    Parameters<typeof rejectWorkspaceInvitation>
  >;
  updateWorkspaceMemberRoleMutation: WorkspaceMutationLike<
    Parameters<typeof updateWorkspaceMemberRole>
  >;
  removeWorkspaceMemberMutation: WorkspaceMutationLike<Parameters<typeof removeWorkspaceMember>>;
  leaveWorkspaceMutation: WorkspaceMutationLike;
}

function parseDirectoryList(value: string, separator = ","): string[] {
  return value
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
}

function nullableDirectoryText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function createOrganizationPageWorkspaceActions(
  deps: OrganizationPageWorkspaceActionDependencies,
): OrganizationPageWorkspaceActions {
  async function handleCreateWorkspace(event: OrganizationPageFormSubmitEvent) {
    event.preventDefault();

    const trimmedDomain = deps.forms.workspaceDomain.trim();
    const trimmedDelegatedEmail = deps.forms.workspaceDelegatedEmail.trim();
    const isTeam = deps.forms.workspaceType === "team";

    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await deps.createWorkspaceMutation.mutateAsync({
          data: {
            name: deps.forms.workspaceName,
            slug: deps.forms.workspaceSlug,
            workspaceType: deps.forms.workspaceType,
            ...(isTeam && trimmedDomain ? { workspaceDomain: trimmedDomain } : {}),
            ...(isTeam && trimmedDelegatedEmail
              ? { delegatedAdminEmail: trimmedDelegatedEmail }
              : {}),
          },
        });

        deps.forms.setWorkspaceName("");
        deps.forms.setWorkspaceSlug("");
        deps.forms.setWorkspaceType("team");
        deps.forms.setWorkspaceDomain("");
        deps.forms.setWorkspaceDelegatedEmail("");

        return mutationResult;
      },
      fallbackMessage: "Atlas could not create that workspace.",
      feedback: deps.feedback,
      refreshWorkspaceData: deps.refreshWorkspaceData,
      successMessage:
        isTeam && trimmedDelegatedEmail
          ? "Workspace created. Admin invite sent to your handoff contact."
          : "Workspace created.",
    });
  }

  async function handleWorkspaceSwitch(organizationId: string) {
    deps.forms.setSelectedOrganizationId(organizationId);

    const switchResult = await runOrganizationPageMutation({
      action: async () => deps.setActiveWorkspaceMutation.mutateAsync({ data: { organizationId } }),
      fallbackMessage: "Atlas could not switch workspaces right now.",
      feedback: deps.feedback,
      refreshWorkspaceData: deps.refreshWorkspaceData,
      successMessage: "Workspace switched.",
    });

    if (!switchResult) {
      deps.forms.setSelectedOrganizationId(deps.activeWorkspaceId ?? "");
    }
  }

  async function handleProfileSave(event: OrganizationPageFormSubmitEvent) {
    event.preventDefault();

    await runOrganizationPageMutation({
      action: async () =>
        deps.updateWorkspaceProfileMutation.mutateAsync({
          data: {
            name: deps.forms.profileName,
            slug: deps.forms.profileSlug,
          },
        }),
      fallbackMessage: "Atlas could not update that workspace.",
      feedback: deps.feedback,
      refreshWorkspaceData: deps.refreshWorkspaceData,
      successMessage: "Workspace details updated.",
    });
  }

  async function handleDirectoryConfigSave(event: OrganizationPageFormSubmitEvent) {
    event.preventDefault();

    await runOrganizationPageMutation({
      action: async () =>
        deps.updateDirectoryConfigMutation.mutateAsync({
          data: {
            methodology: {
              correction_path_template: "/feedback/{slug}?kind=incorrect",
              correction_policy: deps.forms.directoryCorrectionPolicy.trim() || undefined,
              missing_context_path_template: "/feedback/{slug}?kind=missing_context",
              review_policy: deps.forms.directoryReviewPolicy.trim() || undefined,
              source_policy: deps.forms.directorySourcePolicy.trim() || undefined,
              summary: deps.forms.directoryMethodologySummary.trim() || undefined,
            },
            scope: {
              entry_types: parseDirectoryList(deps.forms.directoryEntryTypes),
              geography_labels: parseDirectoryList(deps.forms.directoryGeographyLabels, ";"),
              issue_area_ids: parseDirectoryList(deps.forms.directoryIssueAreaIds),
            },
            sponsor_label: nullableDirectoryText(deps.forms.directorySponsorLabel),
            title: nullableDirectoryText(deps.forms.directoryTitle),
          },
        }),
      fallbackMessage: "Atlas could not update those directory settings.",
      feedback: deps.feedback,
      refreshWorkspaceData: deps.refreshWorkspaceData,
      successMessage: "Directory settings updated.",
    });
  }

  async function handleInviteMember(event: OrganizationPageFormSubmitEvent) {
    event.preventDefault();

    await runOrganizationPageMutation({
      action: async () =>
        deps.inviteWorkspaceMemberMutation.mutateAsync({
          data: {
            email: deps.forms.inviteEmail,
            role: deps.forms.inviteRole,
          },
        }),
      fallbackMessage: "Atlas could not send that invitation.",
      feedback: deps.feedback,
      refreshWorkspaceData: deps.refreshWorkspaceData,
      successMessage: "Invitation sent.",
    });

    deps.forms.setInviteEmail("");
    deps.forms.setInviteRole("member");
  }

  async function handleInvitationDecision(
    invitationId: string,
    action: "accept" | "cancel" | "reject",
  ) {
    const successMessageByAction = {
      accept: "Invitation accepted.",
      cancel: "Invitation canceled.",
      reject: "Invitation declined.",
    } as const;

    await runOrganizationPageMutation({
      action: async () => {
        if (action === "accept") {
          return deps.acceptWorkspaceInvitationMutation.mutateAsync({ data: { invitationId } });
        }
        if (action === "reject") {
          return deps.rejectWorkspaceInvitationMutation.mutateAsync({ data: { invitationId } });
        }
        return deps.cancelWorkspaceInvitationMutation.mutateAsync({ data: { invitationId } });
      },
      fallbackMessage: "Atlas could not update that invitation.",
      feedback: deps.feedback,
      refreshWorkspaceData: deps.refreshWorkspaceData,
      successMessage: successMessageByAction[action],
    });
  }

  async function handleMemberRoleChange(memberId: string, role: "admin" | "member") {
    await runOrganizationPageMutation({
      action: async () =>
        deps.updateWorkspaceMemberRoleMutation.mutateAsync({ data: { memberId, role } }),
      fallbackMessage: "Atlas could not update that member role.",
      feedback: deps.feedback,
      refreshWorkspaceData: deps.refreshWorkspaceData,
      successMessage: "Member role updated.",
    });
  }

  async function handleRemoveMember(memberIdOrEmail: string) {
    await runOrganizationPageMutation({
      action: async () =>
        deps.removeWorkspaceMemberMutation.mutateAsync({ data: { memberIdOrEmail } }),
      fallbackMessage: "Atlas could not remove that member.",
      feedback: deps.feedback,
      refreshWorkspaceData: deps.refreshWorkspaceData,
      successMessage: "Member removed.",
    });
  }

  async function handleLeaveWorkspace() {
    await runOrganizationPageMutation({
      action: async () => deps.leaveWorkspaceMutation.mutateAsync(),
      fallbackMessage: "Atlas could not leave that workspace.",
      feedback: deps.feedback,
      refreshWorkspaceData: deps.refreshWorkspaceData,
      successMessage: "You left the workspace.",
    });
  }

  async function handleResendInvitation(email: string, role: "admin" | "member") {
    await runOrganizationPageMutation({
      action: async () =>
        deps.resendWorkspaceInvitationMutation.mutateAsync({ data: { email, role } }),
      fallbackMessage: "Atlas could not resend that invitation.",
      feedback: deps.feedback,
      refreshWorkspaceData: deps.refreshWorkspaceData,
      successMessage: "Invitation resent.",
    });
  }

  async function handleUpgradeToTeam() {
    const upgradeResult = await runOrganizationPageMutation({
      action: async () => deps.convertWorkspaceToTeamMutation.mutateAsync(),
      fallbackMessage: "Atlas could not upgrade that workspace.",
      feedback: deps.feedback,
      refreshWorkspaceData: deps.refreshWorkspaceData,
      successMessage: "Workspace upgraded to a team. Subscribe to Atlas Team to invite members.",
    });

    if (upgradeResult) {
      await deps.navigate({ to: "/pricing" });
    }
  }

  const pendingInvitationMutationPending =
    deps.acceptWorkspaceInvitationMutation.isPending ||
    deps.cancelWorkspaceInvitationMutation.isPending ||
    deps.rejectWorkspaceInvitationMutation.isPending;

  return {
    createWorkspacePending: deps.createWorkspaceMutation.isPending,
    directoryConfigPending: deps.updateDirectoryConfigMutation.isPending,
    invitePending: deps.inviteWorkspaceMemberMutation.isPending,
    leaveWorkspacePending: deps.leaveWorkspaceMutation.isPending,
    pendingInvitationMutationPending,
    profilePending: deps.updateWorkspaceProfileMutation.isPending,
    removeMemberPending: deps.removeWorkspaceMemberMutation.isPending,
    resendInvitationPending: deps.resendWorkspaceInvitationMutation.isPending,
    selectWorkspacePending: deps.setActiveWorkspaceMutation.isPending,
    updateWorkspaceMemberRolePending: deps.updateWorkspaceMemberRoleMutation.isPending,
    upgradeToTeamPending: deps.convertWorkspaceToTeamMutation.isPending,
    onCreateWorkspace: handleCreateWorkspace,
    onDirectoryConfigSave: handleDirectoryConfigSave,
    onInviteMember: handleInviteMember,
    onInvitationDecision: handleInvitationDecision,
    onLeaveWorkspace: handleLeaveWorkspace,
    onProfileSave: handleProfileSave,
    onSelectWorkspace: handleWorkspaceSwitch,
    onUpdateMemberRole: handleMemberRoleChange,
    onRemoveMember: handleRemoveMember,
    onResendInvitation: handleResendInvitation,
    onUpgradeToTeam: handleUpgradeToTeam,
  };
}
