import type { AtlasWorkspaceInvitation } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { InvitationExpiry } from "./invitation-expiry";

/**
 * Props for the pending-invitations section.
 */
interface PendingWorkspaceInvitationsSectionProps {
  invitations: AtlasWorkspaceInvitation[];
  isPending: boolean;
  onDecision: (invitationId: string, action: "accept" | "reject") => void;
}

/**
 * Invitation review surface shown when the signed-in operator has invitations
 * waiting outside their current active workspace.
 */
export function PendingWorkspaceInvitationsSection({
  invitations,
  isPending,
  onDecision,
}: PendingWorkspaceInvitationsSectionProps) {
  return (
    <section className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h2 className="type-title-large text-ink-strong">Pending invitations</h2>
        <p className="type-body-medium text-ink-soft">
          Review workspace invitations before you decide where Atlas should open next.
        </p>
      </div>

      <div className="space-y-3">
        {invitations.map((invitation) => (
          <article
            key={invitation.id}
            className="border-border flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-white/70 p-4"
          >
            <div className="space-y-1">
              <p className="type-title-small text-ink-strong">{invitation.organizationName}</p>
              <p className="type-body-medium text-ink-soft">Invited as {invitation.role}</p>
              <InvitationExpiry expiresAt={invitation.expiresAt} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isPending}
                onClick={() => {
                  onDecision(invitation.id, "accept");
                }}
              >
                Accept
              </Button>
              <Button
                variant="ghost"
                disabled={isPending}
                onClick={() => {
                  onDecision(invitation.id, "reject");
                }}
              >
                Decline
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
