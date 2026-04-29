import { useEffect, useState } from "react";
import type { AtlasSessionPayload } from "@/domains/access/organization-contracts";

/**
 * Renders the relative time elapsed since `timestamp`, refreshing once
 * per second so the operator sees a live "Last checked: 5s ago" string
 * instead of a stale snapshot.
 */
export function useRelativeTimestamp(timestamp: number | null): string | null {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  if (timestamp === null) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (elapsedSeconds < 5) {
    return "just now";
  }
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  return `${minutes}m ago`;
}

/**
 * Builds the workspace slug Atlas uses when auto-creating the operator's
 * first solo workspace.
 */
export function deriveSoloWorkspaceSlug(displayName: string | null | undefined): {
  name: string;
  slug: string;
} {
  const workspaceName = displayName ? `${displayName}'s Workspace` : "My Workspace";
  const workspaceSlug = workspaceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return { name: workspaceName, slug: workspaceSlug };
}

/**
 * Resolves the destination Atlas should navigate to once the operator's
 * required setup steps are done.  Hands pending-invitation operators to
 * /organization so they can accept; everyone else lands on the explicit
 * `redirectTo` (when supplied) or /discovery.
 */
export function resolveReadyDestination(session: AtlasSessionPayload, redirectTo?: string): string {
  if (session.workspace.onboarding.hasPendingInvitations) {
    return "/organization";
  }
  return redirectTo ?? "/discovery";
}
