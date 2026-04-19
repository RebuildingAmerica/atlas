import { vi } from "vitest";

/**
 * Builds the Better Auth API mock used by `sso.functions` unit tests.
 *
 * The returned object keeps the real Better Auth method names so tests can
 * override only the calls they care about.
 */
export function createSSOFunctionsAuthApi() {
  return {
    deleteSSOProvider: vi.fn().mockResolvedValue(undefined),
    getFullOrganization: vi.fn().mockResolvedValue({
      metadata: {
        workspaceType: "team" as const,
      },
    }),
    getInvitation: vi.fn().mockResolvedValue(null),
    registerSSOProvider: vi.fn().mockResolvedValue({
      domainVerificationToken: "token_123",
      providerId: "atlas-team-google-workspace-oidc",
      redirectURI: "https://atlas.test/api/auth/sso/callback",
    }),
    requestDomainVerification: vi.fn().mockResolvedValue({
      domainVerificationToken: "token_456",
    }),
    updateOrganization: vi.fn().mockResolvedValue(undefined),
    verifyDomain: vi.fn().mockResolvedValue(undefined),
  };
}
