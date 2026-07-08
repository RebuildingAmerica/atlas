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
import { scimClient } from "@better-auth/scim/client";
import { getAuthConfig } from "../config";

/**
 * Builds the spread fragment that injects an explicit baseURL only when
 * the runtime configuration sets one.  Exported so tests can drive both
 * arms of the conditional within a single module instance.
 */
export function selectAuthBaseUrlOverride(authBaseUrl: string | undefined): { baseURL?: string } {
  if (authBaseUrl) {
    return { baseURL: authBaseUrl };
  }
  return {};
}

function createAtlasAuthClient() {
  const authConfig = getAuthConfig();
  return createAuthClient({
    ...selectAuthBaseUrlOverride(authConfig.authBaseUrl),
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
      scimClient(),
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
