import { createAuthClient } from "better-auth/react";
import { ssoClient } from "@better-auth/sso/client";
import {
  magicLinkClient,
  lastLoginMethodClient,
  organizationClient,
} from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { getAuthConfig } from "../config";

const authConfig = getAuthConfig();

function createAtlasAuthClient() {
  return createAuthClient({
    ...(authConfig.authBaseUrl ? { baseURL: authConfig.authBaseUrl } : {}),
    plugins: [
      magicLinkClient(),
      passkeyClient(),
      apiKeyClient(),
      oauthProviderClient(),
      organizationClient(),
      ssoClient({
        domainVerification: {
          enabled: true,
        },
      }),
      lastLoginMethodClient(),
    ],
  });
}

let authClientInstance: ReturnType<typeof createAtlasAuthClient> | null = null;

/**
 * Shared Better Auth client for browser-side auth flows.
 *
 * This is the only client-side entrypoint we use for sign-in, sign-out,
 * passkeys, and session hooks.
 */
export function getAuthClient() {
  if (authClientInstance) {
    return authClientInstance;
  }

  authClientInstance = createAtlasAuthClient();

  return authClientInstance;
}
