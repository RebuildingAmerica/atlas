import type { AtlasOrganizationDetails } from "../../organization-contracts";
import { UserPlus } from "lucide-react";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";
import { Select } from "@/platform/ui/select";
import { invitationRoleOptions } from "./organization-page-helpers";

/**
 * Props for the team-invitations section.
 */
interface TeamInvitationsSectionProps {
  canManageOrganization: boolean;
  inviteEmail: string;
  inviteRole: "admin" | "member";
  isCancelPending: boolean;
  isInvitePending: boolean;
  invitations: AtlasOrganizationDetails["invitations"];
  onCancel: (invitationId: string) => void;
  onEmailChange: (value: string) => void;
  onInviteRoleChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

/**
 * Team invitation section for the active workspace.
 */
export function TeamInvitationsSection({
  canManageOrganization,
  invitations,
  inviteEmail,
  inviteRole,
  isCancelPending,
  isInvitePending,
  onCancel,
  onEmailChange,
  onInviteRoleChange,
  onSubmit,
}: TeamInvitationsSectionProps) {
  return (
    <article className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h2 className="type-title-large text-ink-strong">Invitations</h2>
        <p className="type-body-medium text-ink-soft">
          Invite collaborators only when the active workspace is actually a team.
        </p>
      </div>

      {canManageOrganization ? (
        <form className="space-y-4" onSubmit={onSubmit}>
          <Input
            label="Email"
            value={inviteEmail}
            onChange={onEmailChange}
            placeholder="teammate@your-org.example"
          />
          <Select
            label="Role"
            value={inviteRole}
            onChange={onInviteRoleChange}
            options={invitationRoleOptions.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
          />
          <Button type="submit" disabled={isInvitePending || !inviteEmail.trim()}>
            <span className="inline-flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              {isInvitePending ? "Sending..." : "Send invitation"}
            </span>
          </Button>
        </form>
      ) : (
        <p className="type-body-medium text-ink-soft">
          Only owners and admins can invite new members.
        </p>
      )}

      <div className="space-y-3">
        {invitations.length === 0 ? (
          <p className="type-body-medium text-ink-soft">No pending invitations.</p>
        ) : (
          invitations.map((invitation) => (
            <article
              key={invitation.id}
              className="border-border flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-white/70 p-4"
            >
              <div className="space-y-1">
                <p className="type-title-small text-ink-strong">{invitation.email}</p>
                <p className="type-body-medium text-ink-soft">
                  {invitation.role} · {invitation.status}
                </p>
                <p className="type-body-small text-ink-muted">
                  Expires {new Date(invitation.expiresAt).toLocaleString()}
                </p>
              </div>
              {canManageOrganization ? (
                <Button
                  variant="ghost"
                  disabled={isCancelPending}
                  onClick={() => {
                    onCancel(invitation.id);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </article>
          ))
        )}
      </div>
    </article>
  );
}
