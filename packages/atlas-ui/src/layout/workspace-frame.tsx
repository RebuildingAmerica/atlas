import type { ReactNode } from "react";

export interface WorkspaceFrameProps {
  children: ReactNode;
  rail: ReactNode;
  topNavigation: ReactNode;
}

/**
 * Structural frame for authenticated workspace content. Navigation and
 * identity behavior remain application-owned slots.
 */
export function WorkspaceFrame({ children, rail, topNavigation }: WorkspaceFrameProps) {
  return (
    <div className="flex min-h-screen flex-col">
      {topNavigation}
      <div className="mx-auto grid w-full max-w-[88rem] flex-1 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {rail}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
