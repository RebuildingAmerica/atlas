import type { AtlasOrganizationDetails } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import { Shield, UserPlus } from "lucide-react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import { Select } from "@rebuildingamerica/atlas-ui/ui/select";
import { InvitationExpiry } from "./invitation-expiry";
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
  isResendPending: boolean;
  invitations: AtlasOrganizationDetails["invitations"];
  onCancel: (invitationId: string) => void;
  onEmailChange: (value: string) => void;
  onInviteRoleChange: (value: string) => void;
  onResend: (email: string, role: "admin" | "member") => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

/**
 * Narrows a free-form invitation role to the two roles Atlas re-invites with.
 *
 * @param role - The stored invitation role string.
 */
function toInvitationRole(role: string): "admin" | "member" {
  return role === "admin" ? "admin" : "member";
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
  isResendPending,
  onCancel,
  onEmailChange,
  onInviteRoleChange,
  onResend,
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
            icon={Shield}
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
                <InvitationExpiry expiresAt={invitation.expiresAt} />
              </div>
              {canManageOrganization ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={isResendPending}
                    onClick={() => {
                      onResend(invitation.email, toInvitationRole(invitation.role));
                    }}
                  >
                    Resend
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={isCancelPending}
                    onClick={() => {
                      onCancel(invitation.id);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </article>
  );
}
