import { useQuery } from "@tanstack/react-query";
import { getAtlasSession, type AtlasSessionPayload } from "../session.functions";

/**
 * Shared React Query key for Atlas session reads and readiness refreshes.
 */
export const atlasSessionQueryKey = ["auth", "session"] as const;

/**
 * Safe overridable options for useAtlasSession.
 * Excludes core query configuration to prevent breaking the session fetcher.
 */
interface UseAtlasSessionOptions {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
  queryKey?: unknown[];
  retry?: boolean | number;
}

/**
 * Returns the current Atlas operator session for React components.
 *
 * The server function returns a synthetic local-mode session when the
 * deployment runs with auth disabled, and the real Better Auth session
 * otherwise. Either way the resolved payload carries `isLocal` so UI gates
 * can hide multi-user affordances without re-reading the deploy mode from
 * the env (which Vite does not expose to the browser bundle).
 */
export function useAtlasSession(options?: UseAtlasSessionOptions) {
  return useQuery<AtlasSessionPayload | null>({
    queryFn: getAtlasSession,
    queryKey: options?.queryKey || [...atlasSessionQueryKey],
    staleTime: options?.staleTime ?? 30_000,
    ...(options?.enabled !== undefined && { enabled: options.enabled }),
    ...(options?.gcTime !== undefined && { gcTime: options.gcTime }),
    ...(options?.retry !== undefined && { retry: options.retry }),
  });
}
