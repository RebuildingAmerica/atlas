import { getAppConfig } from "@/platform/config/app-config";

interface AuthEnv {
  ATLAS_AUTH_BASE_PATH?: string;
  ATLAS_PUBLIC_URL?: string;
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
  return getAppConfig(mergedEnv);
}
