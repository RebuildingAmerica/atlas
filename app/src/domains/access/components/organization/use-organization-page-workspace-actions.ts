import { useMutation } from "@tanstack/react-query";
import {
  acceptWorkspaceInvitation,
  cancelWorkspaceInvitation,
  createWorkspace,
  inviteWorkspaceMember,
  leaveWorkspace,
  rejectWorkspaceInvitation,
  removeWorkspaceMember,
  setActiveWorkspace,
  updateWorkspaceMemberRole,
  updateWorkspaceProfile,
} from "@/domains/access/organizations.functions";
import {
  runOrganizationPageMutation,
  type OrganizationPageMutationFeedback,
} from "./organization-page-mutation-helpers";
import type { OrganizationPageForms } from "./use-organization-page-forms";

/**
 * Workspace-management mutations and handlers for the organization page.
 */
export interface OrganizationPageWorkspaceActions {
  createWorkspacePending: boolean;
  invitePending: boolean;
  leaveWorkspacePending: boolean;
  pendingInvitationMutationPending: boolean;
  profilePending: boolean;
  removeMemberPending: boolean;
  selectWorkspacePending: boolean;
  updateWorkspaceMemberRolePending: boolean;
  onCreateWorkspace: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onInviteMember: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onInvitationDecision: (
    invitationId: string,
    action: "accept" | "cancel" | "reject",
  ) => Promise<void>;
  onLeaveWorkspace: () => Promise<void>;
  onProfileSave: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onSelectWorkspace: (organizationId: string) => Promise<void>;
  onUpdateMemberRole: (memberId: string, role: "admin" | "member") => Promise<void>;
  onRemoveMember: (memberIdOrEmail: string) => Promise<void>;
}

interface UseOrganizationPageWorkspaceActionsParams {
  activeWorkspaceId: string | null | undefined;
  feedback: OrganizationPageMutationFeedback;
  forms: OrganizationPageForms;
  refreshWorkspaceData: () => Promise<void>;
}

/**
 * Workspace-management action hook for the organization page.
 *
 * @param params - The shared page state and helpers.
 * @param params.activeWorkspaceId - The current active workspace id.
 * @param params.feedback - Shared flash/error setters.
 * @param params.forms - The current organization-page forms.
 * @param params.refreshWorkspaceData - Shared query refresh callback.
 */
export function useOrganizationPageWorkspaceActions(
  params: UseOrganizationPageWorkspaceActionsParams,
): OrganizationPageWorkspaceActions {
  const createWorkspaceMutation = useMutation({
    mutationFn: createWorkspace,
  });
  const setActiveWorkspaceMutation = useMutation({
    mutationFn: setActiveWorkspace,
  });
  const updateWorkspaceProfileMutation = useMutation({
    mutationFn: updateWorkspaceProfile,
  });
  const inviteWorkspaceMemberMutation = useMutation({
    mutationFn: inviteWorkspaceMember,
  });
  const cancelWorkspaceInvitationMutation = useMutation({
    mutationFn: cancelWorkspaceInvitation,
  });
  const acceptWorkspaceInvitationMutation = useMutation({
    mutationFn: acceptWorkspaceInvitation,
  });
  const rejectWorkspaceInvitationMutation = useMutation({
    mutationFn: rejectWorkspaceInvitation,
  });
  const updateWorkspaceMemberRoleMutation = useMutation({
    mutationFn: updateWorkspaceMemberRole,
  });
  const removeWorkspaceMemberMutation = useMutation({
    mutationFn: removeWorkspaceMember,
  });
  const leaveWorkspaceMutation = useMutation({
    mutationFn: () => leaveWorkspace(),
  });

  /**
   * Creates the operator's first workspace.
   *
   * @param event - The creation form submit event.
   */
  async function handleCreateWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedDomain = params.forms.workspaceDomain.trim();
    const trimmedDelegatedEmail = params.forms.workspaceDelegatedEmail.trim();
    const isTeam = params.forms.workspaceType === "team";

    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await createWorkspaceMutation.mutateAsync({
          data: {
            name: params.forms.workspaceName,
            slug: params.forms.workspaceSlug,
            workspaceType: params.forms.workspaceType,
            ...(isTeam && trimmedDomain ? { workspaceDomain: trimmedDomain } : {}),
            ...(isTeam && trimmedDelegatedEmail
              ? { delegatedAdminEmail: trimmedDelegatedEmail }
              : {}),
          },
        });

        params.forms.setWorkspaceName("");
        params.forms.setWorkspaceSlug("");
        params.forms.setWorkspaceType("team");
        params.forms.setWorkspaceDomain("");
        params.forms.setWorkspaceDelegatedEmail("");

        return mutationResult;
      },
      fallbackMessage: "Atlas could not create that workspace.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage:
        isTeam && trimmedDelegatedEmail
          ? "Workspace created. Admin invite sent to your handoff contact."
          : "Workspace created.",
    });
  }

  /**
   * Switches the current operator into another workspace membership.
   *
   * @param organizationId - The workspace to activate.
   */
  async function handleWorkspaceSwitch(organizationId: string) {
    params.forms.setSelectedOrganizationId(organizationId);

    const switchResult = await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await setActiveWorkspaceMutation.mutateAsync({
          data: {
            organizationId,
          },
        });

        return mutationResult;
      },
      fallbackMessage: "Atlas could not switch workspaces right now.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "Workspace switched.",
    });

    if (!switchResult) {
      params.forms.setSelectedOrganizationId(params.activeWorkspaceId ?? "");
    }
  }

  /**
   * Saves the workspace profile form.
   *
   * @param event - The profile form submit event.
   */
  async function handleProfileSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await updateWorkspaceProfileMutation.mutateAsync({
          data: {
            name: params.forms.profileName,
            slug: params.forms.profileSlug,
          },
        });

        return mutationResult;
      },
      fallbackMessage: "Atlas could not update that workspace.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "Workspace details updated.",
    });
  }

  /**
   * Sends a new team invitation from the active workspace.
   *
   * @param event - The invite form submit event.
   */
  async function handleInviteMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await inviteWorkspaceMemberMutation.mutateAsync({
          data: {
            email: params.forms.inviteEmail,
            role: params.forms.inviteRole,
          },
        });

        params.forms.setInviteEmail("");
        params.forms.setInviteRole("member");

        return mutationResult;
      },
      fallbackMessage: "Atlas could not send that invitation.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "Invitation sent.",
    });
  }

  /**
   * Accepts, rejects, or cancels one workspace invitation.
   *
   * @param invitationId - The Better Auth invitation id.
   * @param action - The invitation action to perform.
   */
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
          const mutationResult = await acceptWorkspaceInvitationMutation.mutateAsync({
            data: { invitationId },
          });

          return mutationResult;
        }

        if (action === "reject") {
          const mutationResult = await rejectWorkspaceInvitationMutation.mutateAsync({
            data: { invitationId },
          });

          return mutationResult;
        }

        const mutationResult = await cancelWorkspaceInvitationMutation.mutateAsync({
          data: { invitationId },
        });

        return mutationResult;
      },
      fallbackMessage: "Atlas could not update that invitation.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: successMessageByAction[action],
    });
  }

  /**
   * Changes one member's role within the active workspace.
   *
   * @param memberId - The Better Auth membership id.
   * @param role - The new role value.
   */
  async function handleMemberRoleChange(memberId: string, role: "admin" | "member") {
    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await updateWorkspaceMemberRoleMutation.mutateAsync({
          data: {
            memberId,
            role,
          },
        });

        return mutationResult;
      },
      fallbackMessage: "Atlas could not update that member role.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "Member role updated.",
    });
  }

  /**
   * Removes a member from the active team workspace.
   *
   * @param memberIdOrEmail - The Better Auth member identifier or email.
   */
  async function handleRemoveMember(memberIdOrEmail: string) {
    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await removeWorkspaceMemberMutation.mutateAsync({
          data: {
            memberIdOrEmail,
          },
        });

        return mutationResult;
      },
      fallbackMessage: "Atlas could not remove that member.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "Member removed.",
    });
  }

  /**
   * Removes the current operator from a non-owner team workspace.
   */
  async function handleLeaveWorkspace() {
    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await leaveWorkspaceMutation.mutateAsync();

        return mutationResult;
      },
      fallbackMessage: "Atlas could not leave that workspace.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "You left the workspace.",
    });
  }

  const pendingInvitationMutationPending =
    acceptWorkspaceInvitationMutation.isPending ||
    cancelWorkspaceInvitationMutation.isPending ||
    rejectWorkspaceInvitationMutation.isPending;

  return {
    createWorkspacePending: createWorkspaceMutation.isPending,
    invitePending: inviteWorkspaceMemberMutation.isPending,
    leaveWorkspacePending: leaveWorkspaceMutation.isPending,
    pendingInvitationMutationPending,
    profilePending: updateWorkspaceProfileMutation.isPending,
    removeMemberPending: removeWorkspaceMemberMutation.isPending,
    selectWorkspacePending: setActiveWorkspaceMutation.isPending,
    updateWorkspaceMemberRolePending: updateWorkspaceMemberRoleMutation.isPending,
    onCreateWorkspace: handleCreateWorkspace,
    onInviteMember: handleInviteMember,
    onInvitationDecision: handleInvitationDecision,
    onLeaveWorkspace: handleLeaveWorkspace,
    onProfileSave: handleProfileSave,
    onSelectWorkspace: handleWorkspaceSwitch,
    onUpdateMemberRole: handleMemberRoleChange,
    onRemoveMember: handleRemoveMember,
  };
}
