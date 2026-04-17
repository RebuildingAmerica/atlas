import type { ReactNode } from "react";
import { WorkspaceNav } from "./workspace-nav";

/**
 * Navigation tab configuration for the shared workspace shell.
 */
interface WorkspaceTabConfig {
  label: string;
  to: string;
}

/**
 * Props accepted by the shared workspace shell.
 */
interface WorkspaceLayoutProps {
  children: ReactNode;
  identitySlot?: ReactNode;
  tabs?: WorkspaceTabConfig[];
}

/**
 * Shell layout for authenticated operator pages.
 *
 * Renders the shared workspace navigation bar and a max-width content area.
 */
export function WorkspaceLayout({ children, identitySlot, tabs }: WorkspaceLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <WorkspaceNav identitySlot={identitySlot} tabs={tabs} />
      <main className="mx-auto w-full max-w-[88rem] flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
