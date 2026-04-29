import type { AtlasWorkspaceMembership } from "@/domains/access/organization-contracts";

interface OAuthWorkspacePickerProps {
  memberships: AtlasWorkspaceMembership[];
  selectedWorkspaceId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Workspace selector shown on the consent screen when the operator
 * belongs to multiple workspaces and the requesting client did not bind
 * one explicitly via an `org:{id}` scope.  Becomes a static line when
 * the operator only has one workspace and the picker would be a no-op.
 */
export function OAuthWorkspacePicker({
  memberships,
  selectedWorkspaceId,
  onSelect,
}: OAuthWorkspacePickerProps) {
  if (memberships.length === 1 && memberships[0]) {
    return (
      <p className="type-body-small text-ink-soft">
        Tokens will be scoped to your workspace,{" "}
        <span className="text-ink-strong font-medium">{memberships[0].name}</span>.
      </p>
    );
  }
  if (memberships.length < 2) return null;
  return (
    <div className="space-y-2">
      <p className="type-label-medium text-ink-muted">Workspace this app will see:</p>
      <ul className="space-y-2">
        {memberships.map((membership) => (
          <li
            key={membership.id}
            className="border-border bg-surface-container-lowest flex items-start gap-3 rounded-[1.4rem] border px-4 py-3"
          >
            <input
              type="radio"
              name="workspace"
              id={`workspace-${membership.id}`}
              value={membership.id}
              checked={selectedWorkspaceId === membership.id}
              onChange={() => {
                onSelect(membership.id);
              }}
              className="mt-1"
            />
            <label htmlFor={`workspace-${membership.id}`} className="flex-1 cursor-pointer">
              <p className="type-title-small text-ink-strong">{membership.name}</p>
              <p className="type-body-small text-ink-soft mt-0.5">Role: {membership.role}</p>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
