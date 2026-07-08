import { createAtlasSessionFixture, createAtlasWorkspace } from "../../../fixtures/access/sessions";
import { createSSOFunctionsAuthApi } from "../../../mocks/access/sso-functions-auth";
import { createStoredWorkspaceIdentityFixture } from "../../../fixtures/access/sso";
import type { Mock } from "vitest";

type SsoFunctionsMock = Mock;

export interface SsoFunctionsMockMap {
  ensureAuthReady: SsoFunctionsMock;
  getAuthRuntimeConfig: SsoFunctionsMock;
  getBrowserSessionHeaders: SsoFunctionsMock;
  getSamlAllowedIssuerOrigins: SsoFunctionsMock;
  isAllowedSamlIssuer: SsoFunctionsMock;
  listStoredWorkspaceSSOProviders: SsoFunctionsMock;
  loadOrganizationRequestContext: SsoFunctionsMock;
  loadStoredWorkspaceIdentity: SsoFunctionsMock;
  requireManagedTeamWorkspace: SsoFunctionsMock;
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
      publicBaseUrl: "https://atlas.test",
      samlAllowedIssuerOrigins: new Set(["https://accounts.google.com"]),
      samlSpPrivateKey: null,
      samlSpPrivateKeyPass: null,
    });
    mocks.isAllowedSamlIssuer.mockReturnValue(true);
    mocks.getSamlAllowedIssuerOrigins.mockReturnValue(["https://accounts.google.com"]);
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
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
