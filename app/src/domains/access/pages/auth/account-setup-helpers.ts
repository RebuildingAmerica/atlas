import { useEffect, useState } from "react";
import type { AtlasSessionPayload } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import { sanitizeAtlasRedirectPath } from "@rebuildingamerica/atlas-access/redirect-paths";

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
 * Resolves the destination Atlas should navigate to once the operator's
 * required setup steps are done.  Hands pending-invitation operators to
 * /organization so they can accept; everyone else lands on the explicit
 * `redirectTo` (when supplied) or /discovery.
 */
export function resolveReadyDestination(session: AtlasSessionPayload, redirectTo?: string): string {
  if (session.workspace.onboarding.hasPendingInvitations) {
    return "/organization";
  }
  return sanitizeAtlasRedirectPath(redirectTo) ?? "/discovery";
}
