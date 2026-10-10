import { getAppConfig } from "@/platform/config/app-config";

interface AuthEnv {
  ATLAS_AUTH_BASE_PATH?: string;
  ATLAS_PUBLIC_URL?: string;
  ATLAS_WEB_CANONICAL_URL?: string;
}

/**
 * Returns the auth-specific slice of app runtime config.
 *
 * This keeps auth code consuming product-level config rather than reading
 * env vars directly.
 */
export function getAuthConfig(env: AuthEnv = {}) {
  const mergedEnv = {
    ...import.meta.env,
    ...env,
  };
  // Candidate and production use identical bundles; sign-in stays with the visitor's host.
  if (mergedEnv.ATLAS_WEB_CANONICAL_URL && typeof window !== "undefined") {
    mergedEnv.ATLAS_PUBLIC_URL = window.location.origin;
    const canonicalAuthPrefix = `${mergedEnv.ATLAS_WEB_CANONICAL_URL}/`;
    if (mergedEnv.ATLAS_AUTH_BASE_PATH?.startsWith(canonicalAuthPrefix)) {
      mergedEnv.ATLAS_AUTH_BASE_PATH = mergedEnv.ATLAS_AUTH_BASE_PATH.slice(
        mergedEnv.ATLAS_WEB_CANONICAL_URL.length,
      );
    }
  }
  return getAppConfig(mergedEnv);
}
