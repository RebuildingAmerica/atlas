import { useQuery } from "@tanstack/react-query";
import { getAuthConfig } from "../config";
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
 * In local mode we synthesize a stable single-user session so the rest of the
 * UI can behave as if an operator is signed in. In auth-enabled mode we defer
 * to Better Auth's browser session hook.
 */
export function useAtlasSession(options?: UseAtlasSessionOptions) {
  const authConfig = getAuthConfig();
  return useQuery<AtlasSessionPayload | null>({
    queryFn: getAtlasSession,
    queryKey: options?.queryKey || [...atlasSessionQueryKey, authConfig.localMode],
    staleTime: options?.staleTime ?? (authConfig.localMode ? Infinity : 30_000),
    ...(options?.enabled !== undefined && { enabled: options.enabled }),
    ...(options?.gcTime !== undefined && { gcTime: options.gcTime }),
    ...(options?.retry !== undefined && { retry: options.retry }),
  });
}
