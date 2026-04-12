import type { ReactNode } from "react";
import { WorkspaceNav } from "./workspace-nav";

interface WorkspaceLayoutProps {
  children: ReactNode;
}

/**
 * Shell layout for authenticated operator pages.
 *
 * Renders the workspace navigation bar at the top and a max-width content
 * area below.
 */
export function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <WorkspaceNav />
      <main className="mx-auto w-full max-w-[88rem] flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
