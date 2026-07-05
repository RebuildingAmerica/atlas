import { Link } from "@tanstack/react-router";
import { AccountRow, AccountSection, AccountSubsection, AccountSurface } from "./rows";

interface AccountProfileSectionProps {
  activeWorkspaceName: string | null;
  email: string | undefined;
  hasPendingInvitations: boolean;
  isLocal: boolean;
  name: string | null | undefined;
  needsWorkspace: boolean;
}

export function AccountProfileSection({
  activeWorkspaceName,
  email,
  hasPendingInvitations,
  isLocal,
  name,
  needsWorkspace,
}: AccountProfileSectionProps) {
  const nameText = name?.trim() || null;
  const showWorkspaceContext =
    !isLocal && (activeWorkspaceName !== null || needsWorkspace || hasPendingInvitations);

  return (
    <AccountSection id="profile" title="Profile">
      <AccountSubsection title="Personal details">
        <AccountSurface>
          <AccountRow label="Name" value={nameText ?? "Not set"} />
          <AccountRow label="Email" value={email ?? "Unavailable"} />
        </AccountSurface>
      </AccountSubsection>

      {showWorkspaceContext ? (
        <AccountSubsection title="Workspace context">
          <AccountSurface>
            {activeWorkspaceName ? (
              <WorkspaceRow label="Workspace" value={activeWorkspaceName} actionLabel="Manage" />
            ) : null}

            {!activeWorkspaceName && needsWorkspace ? (
              <WorkspaceRow label="Workspace" value="Not set" actionLabel="Open" />
            ) : null}

            {hasPendingInvitations ? (
              <WorkspaceRow label="Invitations" value="Pending" actionLabel="Review" />
            ) : null}
          </AccountSurface>
        </AccountSubsection>
      ) : null}
    </AccountSection>
  );
}

interface WorkspaceRowProps {
  actionLabel: string;
  label: string;
  value: string;
}

function WorkspaceRow({ actionLabel, label, value }: WorkspaceRowProps) {
  return (
    <AccountRow
      label={label}
      value={value}
      action={
        <Link
          className="type-label-large text-ink-strong underline underline-offset-2"
          to="/organization"
        >
          {actionLabel}
        </Link>
      }
    />
  );
}
