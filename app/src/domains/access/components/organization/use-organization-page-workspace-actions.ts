import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  acceptWorkspaceInvitation,
  cancelWorkspaceInvitation,
  convertWorkspaceToTeam,
  createWorkspace,
  inviteWorkspaceMember,
  leaveWorkspace,
  rejectWorkspaceInvitation,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
  setActiveWorkspace,
  updateWorkspaceMemberRole,
  updateWorkspaceProfile,
} from "@/domains/access/organizations.functions";
import { updateWorkspaceDirectoryConfig } from "@/domains/workspace/server/directory-config";
import type { OrganizationPageMutationFeedback } from "./organization-page-mutation-helpers";
import { createOrganizationPageWorkspaceActions } from "./use-organization-page-workspace-actions-handlers";
import type { OrganizationPageForms } from "./use-organization-page-forms";

export interface OrganizationPageWorkspaceActions {
  createWorkspacePending: boolean;
  directoryConfigPending: boolean;
  invitePending: boolean;
  leaveWorkspacePending: boolean;
  pendingInvitationMutationPending: boolean;
  profilePending: boolean;
  removeMemberPending: boolean;
  resendInvitationPending: boolean;
  selectWorkspacePending: boolean;
  updateWorkspaceMemberRolePending: boolean;
  upgradeToTeamPending: boolean;
  onCreateWorkspace: (event: OrganizationPageFormSubmitEvent) => Promise<void>;
  onDirectoryConfigSave: (event: OrganizationPageFormSubmitEvent) => Promise<void>;
  onInviteMember: (event: OrganizationPageFormSubmitEvent) => Promise<void>;
  onInvitationDecision: (
    invitationId: string,
    action: "accept" | "cancel" | "reject",
  ) => Promise<void>;
  onLeaveWorkspace: () => Promise<void>;
  onProfileSave: (event: OrganizationPageFormSubmitEvent) => Promise<void>;
  onSelectWorkspace: (organizationId: string) => Promise<void>;
  onUpdateMemberRole: (memberId: string, role: "admin" | "member") => Promise<void>;
  onRemoveMember: (memberIdOrEmail: string) => Promise<void>;
  onResendInvitation: (email: string, role: "admin" | "member") => Promise<void>;
  onUpgradeToTeam: () => Promise<void>;
}

export interface OrganizationPageFormSubmitEvent {
  preventDefault: () => void;
}

interface UseOrganizationPageWorkspaceActionsParams {
  activeWorkspaceId: string | null | undefined;
  feedback: OrganizationPageMutationFeedback;
  forms: OrganizationPageForms;
  refreshWorkspaceData: () => Promise<void>;
}

export function useOrganizationPageWorkspaceActions(
  params: UseOrganizationPageWorkspaceActionsParams,
): OrganizationPageWorkspaceActions {
  const navigate = useNavigate();
  const createWorkspaceMutation = useMutation({ mutationFn: createWorkspace });
  const convertWorkspaceToTeamMutation = useMutation({
    mutationFn: () => convertWorkspaceToTeam(),
  });
  const setActiveWorkspaceMutation = useMutation({ mutationFn: setActiveWorkspace });
  const updateWorkspaceProfileMutation = useMutation({ mutationFn: updateWorkspaceProfile });
  const updateDirectoryConfigMutation = useMutation({
    mutationFn: updateWorkspaceDirectoryConfig,
  });
  const inviteWorkspaceMemberMutation = useMutation({ mutationFn: inviteWorkspaceMember });
  const cancelWorkspaceInvitationMutation = useMutation({
    mutationFn: cancelWorkspaceInvitation,
  });
  const resendWorkspaceInvitationMutation = useMutation({
    mutationFn: resendWorkspaceInvitation,
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
  const leaveWorkspaceMutation = useMutation({ mutationFn: () => leaveWorkspace() });

  return createOrganizationPageWorkspaceActions({
    activeWorkspaceId: params.activeWorkspaceId,
    feedback: params.feedback,
    forms: params.forms,
    refreshWorkspaceData: params.refreshWorkspaceData,
    navigate,
    createWorkspaceMutation,
    convertWorkspaceToTeamMutation,
    setActiveWorkspaceMutation,
    updateWorkspaceProfileMutation,
    updateDirectoryConfigMutation,
    inviteWorkspaceMemberMutation,
    cancelWorkspaceInvitationMutation,
    resendWorkspaceInvitationMutation,
    acceptWorkspaceInvitationMutation,
    rejectWorkspaceInvitationMutation,
    updateWorkspaceMemberRoleMutation,
    removeWorkspaceMemberMutation,
    leaveWorkspaceMutation,
  });
}
