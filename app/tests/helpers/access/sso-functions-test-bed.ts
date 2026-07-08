import { vi } from "vitest";
import { createSsoFunctionsTestHarness } from "../../unit/domains/access/sso.functions.test-harness";

const ssoFunctionsMocks = vi.hoisted(() => ({
  ensureAuthReady: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getSamlAllowedIssuerOrigins: vi.fn(),
  isAllowedSamlIssuer: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  loadOrganizationRequestContext: vi.fn(),
  loadStoredWorkspaceIdentity: vi.fn(),
  listStoredWorkspaceSSOProviders: vi.fn(),
  requireManagedTeamWorkspace: vi.fn(),
}));

const ssoFunctionsTestBed = createSsoFunctionsTestHarness(ssoFunctionsMocks);

export function getSsoFunctionsMocks() {
  return ssoFunctionsMocks;
}

export function getSsoFunctionsBrowserSessionHeaders() {
  return ssoFunctionsTestBed.browserSessionHeaders;
}

export function resetSsoFunctionsTestBed() {
  vi.resetModules();
  vi.clearAllMocks();
  ssoFunctionsTestBed.reset();
}

export function getSsoFunctionsAuthApi() {
  return ssoFunctionsTestBed.getAuthApi();
}
