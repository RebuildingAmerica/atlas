import { KeyRound } from "lucide-react";

interface RolePermission {
  description: string;
  label: string;
}

const ROLE_PERMISSIONS: RolePermission[] = [
  {
    description: "Workspace settings, billing, members, and shared research.",
    label: "Owner",
  },
  {
    description: "Members, invitations, and shared research.",
    label: "Admin",
  },
  {
    description: "Shared research, notes, and exports.",
    label: "Member",
  },
];

/**
 * Compact role guide shown beside member management so access changes are
 * understandable at the moment a workspace lead makes them.
 */
export function RolePermissionsGuide() {
  return (
    <section
      aria-label="Role guide"
      className="border-border bg-surface-container-lowest rounded-[1rem] border px-4 py-4"
    >
      <div className="flex items-center gap-2">
        <KeyRound className="text-accent h-4 w-4" />
        <h3 className="type-title-small text-ink-strong">Role guide</h3>
      </div>
      <div className="border-border mt-3 overflow-hidden rounded-[0.75rem] border">
        <table aria-label="Role permissions" className="w-full border-collapse">
          <thead className="bg-surface">
            <tr className="type-label-small text-ink-muted text-left uppercase">
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Access</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {ROLE_PERMISSIONS.map((role) => (
              <tr key={role.label}>
                <td className="type-label-large text-ink-strong px-3 py-2">{role.label}</td>
                <td className="type-body-small text-ink-soft px-3 py-2">{role.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
