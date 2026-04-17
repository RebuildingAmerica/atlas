import type { z } from "zod";
import type {
  rawWorkspaceSSOProviderSchema,
  AtlasSSOSignInResolution,
} from "@/domains/access/organization-sso";
import type {
  StoredWorkspaceIdentity,
  StoredWorkspaceSSOProvider,
} from "@/domains/access/server/sso-provider-store";

/**
 * Builds one raw Better Auth SSO provider payload for direct server-side
 * normalization tests.
 *
 * @param overrides - Field overrides for the provider payload.
 */
export function createRawWorkspaceSSOProviderFixture(
  overrides: Partial<z.infer<typeof rawWorkspaceSSOProviderSchema>> = {},
): z.infer<typeof rawWorkspaceSSOProviderSchema> {
  return {
    domain: overrides.domain ?? "atlas.test",
    domainVerified: overrides.domainVerified ?? true,
    issuer: overrides.issuer ?? "https://accounts.google.com",
    oidcConfig: overrides.oidcConfig ?? {
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      clientIdLastFour: "1234",
      discoveryEndpoint: "https://accounts.google.com/.well-known/openid-configuration",
      jwksEndpoint: "https://www.googleapis.com/oauth2/v3/certs",
      pkce: true,
      scopes: ["openid", "email", "profile"],
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      tokenEndpointAuthentication: "client_secret_basic",
      userInfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    },
    organizationId: overrides.organizationId ?? "org_team",
    providerId: overrides.providerId ?? "atlas-team-google-workspace-oidc",
    samlConfig: overrides.samlConfig,
    spMetadataUrl:
      overrides.spMetadataUrl ??
      "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-oidc&format=xml",
    type: overrides.type ?? "oidc",
  };
}

/**
 * Builds one stored workspace identity fixture for pre-auth SSO routing tests.
 *
 * @param overrides - Field overrides for the stored workspace identity.
 */
export function createStoredWorkspaceIdentityFixture(
  overrides: Partial<StoredWorkspaceIdentity> = {},
): StoredWorkspaceIdentity {
  return {
    id: overrides.id ?? "org_team",
    name: overrides.name ?? "Atlas Team",
    primaryProviderId: overrides.primaryProviderId ?? "atlas-team-google-workspace-saml",
    slug: overrides.slug ?? "atlas-team",
  };
}

/**
 * Builds one stored workspace-provider fixture for pre-auth SSO routing tests.
 *
 * @param overrides - Field overrides for the stored provider record.
 */
export function createStoredWorkspaceSSOProviderFixture(
  overrides: Partial<StoredWorkspaceSSOProvider> = {},
): StoredWorkspaceSSOProvider {
  return {
    domain: overrides.domain ?? "atlas.test",
    domainVerified: overrides.domainVerified ?? true,
    hasOIDC: overrides.hasOIDC ?? true,
    hasSAML: overrides.hasSAML ?? false,
    issuer: overrides.issuer ?? "https://accounts.google.com",
    organizationId: overrides.organizationId ?? "org_team",
    providerId: overrides.providerId ?? "atlas-team-google-workspace-oidc",
    spMetadataUrl:
      overrides.spMetadataUrl ??
      "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-oidc&format=xml",
  };
}

/**
 * Builds one public sign-in routing result fixture.
 *
 * @param overrides - Field overrides for the public SSO routing result.
 */
export function createSSOSignInResolutionFixture(
  overrides: Partial<AtlasSSOSignInResolution> = {},
): AtlasSSOSignInResolution {
  return {
    organizationName: overrides.organizationName ?? "Atlas Team",
    organizationSlug: overrides.organizationSlug ?? "atlas-team",
    providerId: overrides.providerId ?? "atlas-team-google-workspace-saml",
    providerType: overrides.providerType ?? "saml",
  };
}
