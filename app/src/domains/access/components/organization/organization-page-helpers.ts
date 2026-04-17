/**
 * Supported invitation actions in the organization-management UI.
 */
export type WorkspaceInvitationAction = "accept" | "cancel" | "reject";

/**
 * Workspace type choices Atlas exposes during workspace creation.
 */
export const workspaceTypeOptions = [
  { label: "Individual", value: "individual" },
  { label: "Team", value: "team" },
] as const;

/**
 * Invitation role choices Atlas exposes for team workspaces.
 */
export const invitationRoleOptions = [
  { label: "Member", value: "member" },
  { label: "Admin", value: "admin" },
] as const;

/**
 * Member role choices Atlas exposes when editing existing team memberships.
 */
export const memberRoleOptions = [
  { label: "Member", value: "member" },
  { label: "Admin", value: "admin" },
] as const;

/**
 * Normalizes free-form workspace names into slug candidates.
 *
 * @param value - The user-entered workspace name.
 */
export function buildWorkspaceSlugCandidate(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
}
