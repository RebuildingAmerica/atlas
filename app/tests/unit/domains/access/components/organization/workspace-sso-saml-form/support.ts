import type { AtlasWorkspaceSSOSetupValues } from "@/domains/access/organization-sso-defaults";
import type { WorkspaceSAMLSetupFormState } from "@/domains/access/components/organization/organization-page-controller";

export interface SetupOverrides {
  workspaceDomainSuggestion?: string;
}

export function buildSetup(overrides: SetupOverrides = {}): AtlasWorkspaceSSOSetupValues {
  return {
    dnsTokenPrefix: "_better-auth-token",
    googleWorkspaceIssuer: "https://accounts.google.com",
    googleWorkspaceScopes: ["openid", "email", "profile"],
    oidcProviderIdSuggestion: "oidc-suggestion",
    oidcRedirectUrl: "https://atlas.test/callback",
    samlAcsUrl: "https://atlas.test/acs",
    samlEntityId: "https://atlas.test/metadata",
    samlMetadataUrl: "https://atlas.test/metadata.xml",
    samlProviderIdSuggestion: "saml-suggestion",
    workspaceDomainSuggestion: "atlas.test",
    ...overrides,
  };
}

export function buildForm(
  overrides: Partial<WorkspaceSAMLSetupFormState> = {},
): WorkspaceSAMLSetupFormState {
  return {
    certificate: "",
    domain: "",
    entryPoint: "",
    issuer: "",
    providerId: "",
    setAsPrimary: false,
    ...overrides,
  };
}
