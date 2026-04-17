import type { AtlasOrganizationDetails } from "../../organization-contracts";
import { Shield, Users } from "lucide-react";
import { Button } from "@/platform/ui/button";
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
    <article className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="type-title-large text-ink-strong">Members</h2>
          <p className="type-body-medium text-ink-soft">
            Keep roles legible and avoid dangling team affordances in personal workspaces.
          </p>
        </div>
        <span className="border-border text-ink-soft inline-flex items-center gap-2 rounded-full border px-3 py-1">
          <Users className="h-4 w-4" />
          {members.length} members
        </span>
      </div>

      <div className="space-y-3">
        {members.map((member) => {
          const isCurrentUser = member.userId === currentUserId;
          const isOwner = member.role === "owner";
          const canEditMember = canManageOrganization && !isCurrentUser && !isOwner;

          return (
            <article
              key={member.id}
              className="border-border flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-white/70 p-4"
            >
              <div className="space-y-1">
                <p className="type-title-small text-ink-strong">{member.name}</p>
                <p className="type-body-medium text-ink-soft">{member.email}</p>
                <p className="type-body-small text-ink-muted">
                  Joined {new Date(member.createdAt).toLocaleDateString()}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {canEditMember ? (
                  <>
                    <select
                      aria-label={`Role for ${member.email}`}
                      className="type-body-medium border-border bg-surface text-ink-strong rounded-xl border px-3 py-2"
                      value={member.role}
                      onChange={(event) => {
                        const nextRole = event.target.value;
                        if (nextRole === "admin" || nextRole === "member") {
                          onRoleChange(member.id, nextRole);
                        }
                      }}
                    >
                      {memberRoleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      disabled={isRemovePending}
                      onClick={() => {
                        onRemove(member.id);
                      }}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <span className="border-border text-ink-soft inline-flex items-center gap-2 rounded-full border px-3 py-1">
                    <Shield className="h-4 w-4" />
                    {member.role}
                    {isCurrentUser ? " · you" : ""}
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </article>
  );
}
