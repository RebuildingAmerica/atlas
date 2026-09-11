import { createAtlasSessionFixture, createAtlasWorkspace } from "../../../fixtures/access/sessions";
import { createSSOFunctionsAuthApi } from "../../../mocks/access/sso-functions-auth";
import { createStoredWorkspaceIdentityFixture } from "../../../fixtures/access/sso";
import { DEFAULT_ANONYMOUS_RATE_LIMIT } from "@/domains/access/server/anonymous-rate-limit";
import { vi, type Mock } from "vitest";

type SsoFunctionsMock = Mock;

export interface SsoFunctionsMockMap {
  ensureAuthReady: SsoFunctionsMock;
  getAuthRuntimeConfig: SsoFunctionsMock;
  getBrowserSessionHeaders: SsoFunctionsMock;
  getSamlAllowedIssuerOrigins: SsoFunctionsMock;
  getServerFnRequest: SsoFunctionsMock;
  isAllowedSamlIssuer: SsoFunctionsMock;
  listStoredWorkspaceSSOProviders: SsoFunctionsMock;
  loadOrganizationRequestContext: SsoFunctionsMock;
  loadStoredWorkspaceIdentity: SsoFunctionsMock;
  requireManagedTeamWorkspace: SsoFunctionsMock;
}

/**
 * Builds the request a server function sees, carrying the forwarding chain the
 * anonymous limiter keys on. The client address sits one hop in front of the
 * proxy, matching DEFAULT_ANONYMOUS_RATE_LIMIT.trustedProxyHops.
 *
 * @param clientIp - Address the limiter should treat as the caller.
 */
export function createSsoServerFnRequest(clientIp = "203.0.113.7"): Request {
  return new Request("https://atlas.test/_serverFn/sso-support/resolveWorkspaceSSOSignIn", {
    method: "POST",
    headers: {
      "x-forwarded-for": `${clientIp}, 70.0.0.1`,
    },
  });
}

export function createSsoFunctionsTestHarness(mocks: SsoFunctionsMockMap) {
  const browserSessionHeaders = new Headers({
    cookie: "better-auth.session_token=test-token",
  });

  const managedTeamWorkspace = createAtlasWorkspace().activeOrganization;
  if (!managedTeamWorkspace) {
    throw new TypeError("Expected the access session fixture to expose an active workspace.");
  }

  let authApi = createSSOFunctionsAuthApi();

  function reset() {
    // clearMocks in vitest.config.ts wipes call history but leaves spies
    // installed, so a console spy in one test would silence the rest of the
    // file.
    vi.restoreAllMocks();
    authApi = createSSOFunctionsAuthApi();

    const session = createAtlasSessionFixture({
      workspace: createAtlasWorkspace({
        activeOrganization: managedTeamWorkspace,
      }),
    });

    mocks.ensureAuthReady.mockResolvedValue({
      api: authApi,
    });
    mocks.getAuthRuntimeConfig.mockReturnValue({
      anonymousRateLimit: DEFAULT_ANONYMOUS_RATE_LIMIT,
      publicBaseUrl: "https://atlas.test",
      samlAllowedIssuerOrigins: new Set(["https://accounts.google.com"]),
      samlSpPrivateKey: null,
      samlSpPrivateKeyPass: null,
    });
    mocks.isAllowedSamlIssuer.mockReturnValue(true);
    mocks.getSamlAllowedIssuerOrigins.mockReturnValue(["https://accounts.google.com"]);
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
    mocks.getServerFnRequest.mockImplementation(() => createSsoServerFnRequest());
    mocks.loadOrganizationRequestContext.mockResolvedValue({
      auth: {
        api: authApi,
      },
      headers: browserSessionHeaders,
      session,
    });
    mocks.loadStoredWorkspaceIdentity.mockReturnValue(createStoredWorkspaceIdentityFixture());
    mocks.listStoredWorkspaceSSOProviders.mockReturnValue([]);
    mocks.requireManagedTeamWorkspace.mockReturnValue(managedTeamWorkspace);
  }

  function getAuthApi() {
    return authApi;
  }

  return {
    browserSessionHeaders,
    getAuthApi,
    managedTeamWorkspace,
    reset,
  };
}
