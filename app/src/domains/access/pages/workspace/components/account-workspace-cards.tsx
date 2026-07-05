import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AccountSettingsRow, AccountSettingsSurface } from "./account-settings-section";

interface AccountWorkspaceCardsProps {
  activeWorkspaceName: string | null;
  hasPendingInvitations: boolean;
  isLocal: boolean;
  needsWorkspace: boolean;
}

export function AccountWorkspaceCards({
  activeWorkspaceName,
  hasPendingInvitations,
  isLocal,
  needsWorkspace,
}: AccountWorkspaceCardsProps) {
  if (isLocal) {
    return null;
  }

  const rows: ReactNode[] = [];

  if (activeWorkspaceName) {
    rows.push(
      <WorkspaceRow
        key="workspace"
        label="Workspace"
        value={activeWorkspaceName}
        actionLabel="Manage"
      />,
    );
  } else if (needsWorkspace) {
    rows.push(
      <WorkspaceRow key="workspace" label="Workspace" value="Not set" actionLabel="Open" />,
    );
  }

  if (hasPendingInvitations) {
    rows.push(
      <WorkspaceRow key="invitations" label="Invitations" value="Pending" actionLabel="Review" />,
    );
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <section id="workspace" className="scroll-mt-24 space-y-3">
      <h2 className="type-title-large text-ink-strong">Workspace</h2>
      <AccountSettingsSurface>{rows}</AccountSettingsSurface>
    </section>
  );
}

interface WorkspaceRowProps {
  actionLabel: string;
  label: string;
  value: string;
}

function WorkspaceRow({ actionLabel, label, value }: WorkspaceRowProps) {
  return (
    <AccountSettingsRow
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
