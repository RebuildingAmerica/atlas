import { getAppConfig } from "@/platform/config/app-config";

interface AuthEnv {
  ATLAS_AUTH_BASE_PATH?: string;
  ATLAS_DEPLOY_MODE?: string;
  ATLAS_PUBLIC_URL?: string;
}

/**
 * Returns the auth-specific slice of app runtime config.
 *
 * This keeps auth code consuming product-level config rather than reading
 * env vars directly.
 */
export function getAuthConfig(env: AuthEnv = import.meta.env) {
  return getAppConfig(env);
}

/**
 * Builds the trusted actor headers the app uses when it calls the backend on
 * behalf of an authenticated browser operator.
 */
export function createInternalAuthHeaders(
  actor: {
    email: string;
    id: string;
  },
  internalSecret: string,
): Record<string, string> {
  return {
    "X-Atlas-Actor-Email": actor.email,
    "X-Atlas-Actor-Id": actor.id,
    "X-Atlas-Internal-Secret": internalSecret,
  };
}
