import type { AtlasOrganizationDetails } from "../../organization-contracts";
import { Shield, Trash2, Users } from "lucide-react";
import { Button } from "@/platform/ui/button";
import { Select } from "@/platform/ui/select";
import { memberRoleOptions } from "./organization-page-helpers";

/**
 * Props for the team-members section.
 */
interface TeamMembersSectionProps {
  canManageOrganization: boolean;
  currentUserId: string | undefined;
  isRemovePending: boolean;
  members: AtlasOrganizationDetails["members"];
  onRemove: (memberIdOrEmail: string) => void;
  onRoleChange: (memberId: string, role: "admin" | "member") => void;
}

/**
 * Team member roster for the active workspace.
 */
export function TeamMembersSection({
  canManageOrganization,
  currentUserId,
  isRemovePending,
  members,
  onRemove,
  onRoleChange,
}: TeamMembersSectionProps) {
  return (
    <section className="border-border-strong bg-surface space-y-4 rounded-[1rem] border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="type-title-large text-ink-strong">Members</h2>
          <p className="type-body-medium text-ink-soft">
            Active people with access to this workspace.
          </p>
        </div>
        <span className="border-border text-ink-soft inline-flex items-center gap-2 rounded-full border px-3 py-1">
          <Users className="h-4 w-4" />
          {members.length} members
        </span>
      </div>

      <div className="border-border overflow-x-auto rounded-[0.75rem] border">
        <table aria-label="Workspace members" className="w-full min-w-[42rem] border-collapse">
          <thead className="bg-surface-container-lowest">
            <tr className="type-label-small text-ink-muted text-left uppercase">
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {members.map((member) => {
              const isCurrentUser = member.userId === currentUserId;
              const isOwner = member.role === "owner";
              const canEditMember = canManageOrganization && !isCurrentUser && !isOwner;

              return (
                <tr key={member.id} className="align-middle">
                  <td className="px-4 py-3">
                    <p className="type-title-small text-ink-strong">{member.name}</p>
                    <p className="type-body-small text-ink-soft">{member.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {canEditMember ? (
                      <Select
                        ariaLabel={`Role for ${member.email}`}
                        icon={Shield}
                        size="compact"
                        value={member.role}
                        onChange={(nextRole) => {
                          if (nextRole === "admin" || nextRole === "member") {
                            onRoleChange(member.id, nextRole);
                          }
                        }}
                        options={memberRoleOptions.map((option) => ({
                          label: option.label,
                          value: option.value,
                        }))}
                      />
                    ) : (
                      <span className="text-ink-soft inline-flex items-center gap-2">
                        <Shield className="h-4 w-4" aria-hidden />
                        <span className="type-label-large">
                          {member.role}
                          {isCurrentUser ? " · you" : ""}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="type-body-small text-ink-soft px-4 py-3">
                    {new Date(member.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEditMember ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        ariaLabel={`Remove ${member.name}`}
                        title={`Remove ${member.name}`}
                        disabled={isRemovePending}
                        onClick={() => {
                          onRemove(member.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        <span className="sr-only">Remove</span>
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
