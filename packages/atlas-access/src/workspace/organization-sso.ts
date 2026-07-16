import { z } from "zod";
import type { AtlasSsoPrimaryHistoryEntry } from "./organization-metadata";
import type { AtlasWorkspaceSSOSetupValues } from "./organization-sso-defaults";

export {
  GOOGLE_WORKSPACE_ISSUER,
  buildGoogleWorkspaceOIDCProviderId,
  buildGoogleWorkspaceSAMLProviderId,
  buildWorkspaceOIDCRedirectUrl,
  buildWorkspaceSamlAcsUrl,
  buildWorkspaceSamlEntityId,
  buildWorkspaceSamlMetadataUrl,
  buildWorkspaceSSOSetupValues,
  buildWorkspaceSSODomainVerificationHost,
  googleWorkspaceScopeList,
  workspaceSSOProviderMatchesDomain,
} from "./organization-sso-defaults";

/**
 * Supported enterprise provider types Atlas exposes in the organization UI.
 */
export const atlasSSOProviderTypeSchema = z.enum(["oidc", "saml"]);

/**
 * Provider type Atlas exposes in the organization UI and sign-in resolver.
 */
export type AtlasSSOProviderType = z.infer<typeof atlasSSOProviderTypeSchema>;

const oidcProviderSchema = z.object({
  authorizationEndpoint: z.string().optional(),
  clientIdLastFour: z.string(),
  discoveryEndpoint: z.string(),
  jwksEndpoint: z.string().optional(),
  pkce: z.boolean(),
  scopes: z.array(z.string()).optional(),
  tokenEndpoint: z.string().optional(),
  tokenEndpointAuthentication: z.enum(["client_secret_basic", "client_secret_post"]).optional(),
  userInfoEndpoint: z.string().optional(),
});

const samlCertificateSchema = z.union([
  z.object({
    fingerprintSha256: z.string(),
    notAfter: z.string(),
    notBefore: z.string(),
    publicKeyAlgorithm: z.string(),
  }),
  z.object({
    error: z.string(),
  }),
]);

const samlProviderSchema = z.object({
  audience: z.string().optional(),
  authnRequestsSigned: z.boolean().optional(),
  callbackUrl: z.string(),
  certificate: samlCertificateSchema,
  digestAlgorithm: z.string().optional(),
  entryPoint: z.string(),
  identifierFormat: z.string().optional(),
  signatureAlgorithm: z.string().optional(),
  wantAssertionsSigned: z.boolean().optional(),
});

/**
 * Better Auth's redacted provider payload returned from the authenticated SSO
 * list/get endpoints.
 */
export const rawWorkspaceSSOProviderSchema = z.object({
  domain: z.string(),
  domainVerified: z.boolean(),
  issuer: z.string(),
  oidcConfig: oidcProviderSchema.optional(),
  organizationId: z.string().nullable(),
  providerId: z.string(),
  samlConfig: samlProviderSchema.optional(),
  spMetadataUrl: z.string(),
  type: z.string(),
});

/**
 * Better Auth's authenticated SSO provider-list payload.
 */
export const rawWorkspaceSSOProviderListSchema = z.object({
  providers: z.array(rawWorkspaceSSOProviderSchema),
});

/**
 * Certificate details Atlas shows for a configured SAML identity provider.
 */
export interface AtlasSAMLProviderCertificate {
  errorMessage: string | null;
  fingerprintSha256: string | null;
  notAfter: string | null;
  notBefore: string | null;
  publicKeyAlgorithm: string | null;
}

/**
 * Redacted OIDC provider details Atlas can safely surface in the workspace UI.
 */
export interface AtlasOIDCProviderSummary {
  authorizationEndpoint: string | null;
  clientIdLastFour: string;
  discoveryEndpoint: string;
  jwksEndpoint: string | null;
  pkce: boolean;
  scopes: string[];
  tokenEndpoint: string | null;
  tokenEndpointAuthentication: "client_secret_basic" | "client_secret_post" | null;
  userInfoEndpoint: string | null;
}

/**
 * Redacted SAML provider details Atlas can safely surface in the workspace UI.
 */
export interface AtlasSAMLProviderSummary {
  audience: string | null;
  authnRequestsSigned: boolean;
  callbackUrl: string;
  certificate: AtlasSAMLProviderCertificate;
  digestAlgorithm: string | null;
  entryPoint: string;
  identifierFormat: string | null;
  signatureAlgorithm: string | null;
  wantAssertionsSigned: boolean;
}

/**
 * One configured enterprise provider attached to a workspace.
 */
export interface AtlasWorkspaceSSOProvider {
  domain: string;
  domainVerificationHost: string;
  domainVerificationTokenAvailable: boolean;
  domainVerified: boolean;
  isPrimary: boolean;
  issuer: string;
  oidc: AtlasOIDCProviderSummary | null;
  organizationId: string | null;
  providerId: string;
  providerType: AtlasSSOProviderType;
  saml: AtlasSAMLProviderSummary | null;
  spMetadataUrl: string;
}

/**
 * Full SSO state Atlas renders inside organization management.
 */
export interface AtlasWorkspaceSSOState {
  primaryHistory: AtlasSsoPrimaryHistoryEntry[];
  primaryProviderId: string | null;
  providers: AtlasWorkspaceSSOProvider[];
  setup: AtlasWorkspaceSSOSetupValues;
}

/**
 * Public sign-in hint Atlas can safely compute before a session exists.
 */
export interface AtlasSSOSignInResolution {
  organizationName: string | null;
  organizationSlug: string | null;
  providerId: string;
  providerType: AtlasSSOProviderType;
}

export {
  buildWorkspaceSSOSelectionProvider,
  buildWorkspaceSSOState,
  selectPreferredWorkspaceSSOProvider,
  toAtlasWorkspaceSSOProvider,
} from "./organization-sso-state";
