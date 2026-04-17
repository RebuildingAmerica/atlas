import type { AtlasOrganizationDetails } from "../../organization-contracts";
import { Button } from "@/platform/ui/button";

/**
 * Props for the workspace-membership section.
 */
interface WorkspaceMembershipSectionProps {
  isPending: boolean;
  organization: AtlasOrganizationDetails;
  onLeave: () => void;
}

/**
 * Membership section for the active team workspace.
 *
 * This keeps the "leave workspace" action explicit and readable without
 * burying it inside the member list.
 */
export function WorkspaceMembershipSection({
  isPending,
  onLeave,
  organization,
}: WorkspaceMembershipSectionProps) {
  const currentRole = organization.role;
  const ownerCannotLeave = currentRole === "owner";

  return (
    <article className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h2 className="type-title-large text-ink-strong">Your membership</h2>
        <p className="type-body-medium text-ink-soft">
          Atlas keeps workspace membership controls visible, but only when they help the current
          operator make a clean decision.
        </p>
      </div>

      <div className="border-border rounded-[1.25rem] border bg-white/70 p-4">
        <p className="type-title-small text-ink-strong">{organization.name}</p>
        <p className="type-body-medium text-ink-soft mt-2">
          Role: {currentRole} · Workspace type: {organization.workspaceType}
        </p>
      </div>

      {ownerCannotLeave ? (
        <div className="border-border bg-surface-container-lowest rounded-[1.25rem] border p-4">
          <p className="type-title-small text-ink-strong">Owner leave is blocked</p>
          <p className="type-body-medium text-ink-soft mt-2">
            Transfer ownership before leaving this team so Atlas never strands a workspace without
            an accountable operator.
          </p>
        </div>
      ) : (
        <div className="border-border bg-surface-container-lowest space-y-3 rounded-[1.25rem] border p-4">
          <p className="type-title-small text-ink-strong">Leave this workspace</p>
          <p className="type-body-medium text-ink-soft">
            You will keep your Atlas account, but this shared workspace will disappear from your
            navigation and team features until you are invited back.
          </p>
          <Button
            variant="secondary"
            disabled={isPending}
            onClick={() => {
              onLeave();
            }}
          >
            {isPending ? "Leaving..." : "Leave workspace"}
          </Button>
        </div>
      )}
    </article>
  );
}
