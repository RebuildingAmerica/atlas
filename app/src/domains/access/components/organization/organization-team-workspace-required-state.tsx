/**
 * Team-only reminder shown on the focused enterprise SSO page when the active
 * workspace is personal.
 */
export function OrganizationTeamWorkspaceRequiredState() {
  return (
    <div className="border-border bg-surface rounded-[1.5rem] border p-6">
      <p className="type-title-medium text-ink-strong">
        Enterprise SSO is available only for team workspaces
      </p>
      <p className="type-body-medium text-ink-soft mt-2">
        Switch to a team workspace or create one from the full organization settings page.
      </p>
    </div>
  );
}
