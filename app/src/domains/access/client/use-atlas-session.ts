import { useQuery } from "@tanstack/react-query";
import { getAuthConfig } from "../config";
import { getAtlasSession, type AtlasSessionPayload } from "../session.functions";

/**
 * Shared React Query key for Atlas session reads and readiness refreshes.
 */
export const atlasSessionQueryKey = ["auth", "session"] as const;

/**
 * Returns the current Atlas operator session for React components.
 *
 * In local mode we synthesize a stable single-user session so the rest of the
 * UI can behave as if an operator is signed in. In auth-enabled mode we defer
 * to Better Auth's browser session hook.
 */
export function useAtlasSession() {
  const authConfig = getAuthConfig();
  return useQuery<AtlasSessionPayload | null>({
    queryFn: getAtlasSession,
    queryKey: [...atlasSessionQueryKey, authConfig.localMode],
    staleTime: authConfig.localMode ? Infinity : 30_000,
  });
}
