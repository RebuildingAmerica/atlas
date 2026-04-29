import { Link } from "@tanstack/react-router";

interface AccountWorkspaceCardsProps {
  activeWorkspaceName: string | null;
  hasPendingInvitations: boolean;
  isLocal: boolean;
  needsWorkspace: boolean;
}

/**
 * Stack of three optional workspace-context cards on the account page:
 * the "create your first workspace" prompt, the pending-invitations
 * reminder, and the current-workspace summary card with a link into
 * the workspace management surface.
 */
export function AccountWorkspaceCards({
  activeWorkspaceName,
  hasPendingInvitations,
  isLocal,
  needsWorkspace,
}: AccountWorkspaceCardsProps) {
  return (
    <>
      {needsWorkspace && !isLocal ? (
        <div className="border-outline bg-surface rounded-[1.5rem] border p-5">
          <p className="type-title-small text-on-surface">Workspace setup is waiting</p>
          <p className="type-body-medium text-outline mt-2">
            Finish creating your first workspace so Atlas can keep account security separate from
            workspace context.
          </p>
          <div className="mt-4">
            <Link className="type-label-large text-on-surface underline" to="/organization">
              Open workspace setup
            </Link>
          </div>
        </div>
      ) : null}

      {hasPendingInvitations && !isLocal ? (
        <div className="border-outline bg-surface rounded-[1.5rem] border p-5">
          <p className="type-title-small text-on-surface">Workspace invitations waiting</p>
          <p className="type-body-medium text-outline mt-2">
            Review your pending invitations before Atlas decides which workspace should open next.
          </p>
          <div className="mt-4">
            <Link className="type-label-large text-on-surface underline" to="/organization">
              Review invitations
            </Link>
          </div>
        </div>
      ) : null}

      {activeWorkspaceName && !isLocal ? (
        <div className="border-outline-variant bg-surface-container-lowest rounded-[1.5rem] border p-5">
          <p className="type-title-small text-on-surface">Current workspace</p>
          <p className="type-body-medium text-outline mt-2">{activeWorkspaceName}</p>
          <div className="mt-4">
            <Link className="type-label-large text-on-surface underline" to="/organization">
              Manage workspace
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
