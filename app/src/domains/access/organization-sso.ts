import { z } from "zod";
import {
  buildWorkspaceSSOSetupValues,
  buildWorkspaceSSODomainVerificationHost,
  type AtlasWorkspaceSSOSetupValues,
  workspaceSSOProviderMatchesDomain,
} from "./organization-sso-defaults";

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
/**
 * One row of the workspace's primary-SSO-provider audit trail, as exposed
 * to the UI.  Mirrors the shape persisted in workspace metadata.
 */
export interface AtlasSsoPrimaryHistoryEntry {
  changedAt: string;
  changedByEmail: string | null;
  providerId: string | null;
}

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

/**
 * Converts Better Auth's redacted certificate payload into Atlas's stable UI
 * contract.
 *
 * @param certificate - The raw Better Auth certificate payload.
 */
function toAtlasSamlCertificate(
  certificate: z.infer<typeof samlCertificateSchema>,
): AtlasSAMLProviderCertificate {
  if ("error" in certificate) {
    return {
      errorMessage: certificate.error,
      fingerprintSha256: null,
      notAfter: null,
      notBefore: null,
      publicKeyAlgorithm: null,
    };
  }

  return {
    errorMessage: null,
    fingerprintSha256: certificate.fingerprintSha256,
    notAfter: certificate.notAfter,
    notBefore: certificate.notBefore,
    publicKeyAlgorithm: certificate.publicKeyAlgorithm,
  };
}

/**
 * Converts one Better Auth SSO provider payload into Atlas's UI contract.
 *
 * @param provider - The redacted Better Auth provider payload.
 * @param primaryProviderId - The current workspace-level primary provider id.
 */
export function toAtlasWorkspaceSSOProvider(
  provider: z.infer<typeof rawWorkspaceSSOProviderSchema>,
  primaryProviderId: string | null,
): AtlasWorkspaceSSOProvider {
  const providerType = atlasSSOProviderTypeSchema.parse(provider.type);
  const oidc = provider.oidcConfig
    ? {
        authorizationEndpoint: provider.oidcConfig.authorizationEndpoint ?? null,
        clientIdLastFour: provider.oidcConfig.clientIdLastFour,
        discoveryEndpoint: provider.oidcConfig.discoveryEndpoint,
        jwksEndpoint: provider.oidcConfig.jwksEndpoint ?? null,
        pkce: provider.oidcConfig.pkce,
        scopes: provider.oidcConfig.scopes ?? [],
        tokenEndpoint: provider.oidcConfig.tokenEndpoint ?? null,
        tokenEndpointAuthentication: provider.oidcConfig.tokenEndpointAuthentication ?? null,
        userInfoEndpoint: provider.oidcConfig.userInfoEndpoint ?? null,
      }
    : null;
  const saml = provider.samlConfig
    ? {
        audience: provider.samlConfig.audience ?? null,
        authnRequestsSigned: provider.samlConfig.authnRequestsSigned ?? false,
        callbackUrl: provider.samlConfig.callbackUrl,
        certificate: toAtlasSamlCertificate(provider.samlConfig.certificate),
        digestAlgorithm: provider.samlConfig.digestAlgorithm ?? null,
        entryPoint: provider.samlConfig.entryPoint,
        identifierFormat: provider.samlConfig.identifierFormat ?? null,
        signatureAlgorithm: provider.samlConfig.signatureAlgorithm ?? null,
        wantAssertionsSigned: provider.samlConfig.wantAssertionsSigned ?? false,
      }
    : null;

  return {
    domain: provider.domain,
    domainVerificationHost: buildWorkspaceSSODomainVerificationHost(provider.providerId),
    domainVerificationTokenAvailable: true,
    domainVerified: provider.domainVerified,
    isPrimary: provider.providerId === primaryProviderId,
    issuer: provider.issuer,
    oidc,
    organizationId: provider.organizationId,
    providerId: provider.providerId,
    providerType,
    saml,
    spMetadataUrl: provider.spMetadataUrl,
  };
}

/**
 * Builds a minimal provider candidate Atlas can use during pre-auth SSO
 * routing.
 *
 * @param params - The minimal provider details Atlas already knows.
 * @param params.domain - The configured provider domain string.
 * @param params.domainVerified - Whether Better Auth has verified the domain.
 * @param params.isPrimary - Whether this provider is currently primary.
 * @param params.issuer - The configured provider issuer.
 * @param params.organizationId - The linked Better Auth organization id.
 * @param params.providerId - The Better Auth provider id.
 * @param params.providerType - The provider type Atlas should prefer.
 */
export function buildWorkspaceSSOSelectionProvider(params: {
  domain: string;
  domainVerified: boolean;
  isPrimary: boolean;
  issuer: string;
  organizationId: string | null;
  providerId: string;
  providerType: AtlasSSOProviderType;
}): AtlasWorkspaceSSOProvider {
  return {
    domain: params.domain,
    domainVerificationHost: "",
    domainVerificationTokenAvailable: false,
    domainVerified: params.domainVerified,
    isPrimary: params.isPrimary,
    issuer: params.issuer,
    oidc:
      params.providerType === "oidc"
        ? {
            authorizationEndpoint: null,
            clientIdLastFour: "",
            discoveryEndpoint: "",
            jwksEndpoint: null,
            pkce: true,
            scopes: [],
            tokenEndpoint: null,
            tokenEndpointAuthentication: null,
            userInfoEndpoint: null,
          }
        : null,
    organizationId: params.organizationId,
    providerId: params.providerId,
    providerType: params.providerType,
    saml:
      params.providerType === "saml"
        ? {
            audience: null,
            authnRequestsSigned: false,
            callbackUrl: "",
            certificate: {
              errorMessage: null,
              fingerprintSha256: null,
              notAfter: null,
              notBefore: null,
              publicKeyAlgorithm: null,
            },
            digestAlgorithm: null,
            entryPoint: "",
            identifierFormat: null,
            signatureAlgorithm: null,
            wantAssertionsSigned: false,
          }
        : null,
    spMetadataUrl: "",
  };
}

/**
 * Extracts one normalized email domain from an operator email address.
 *
 * @param email - The signed-in operator email address.
 */
function extractEmailDomain(email: string): string {
  const [localPart, domain] = email.trim().toLowerCase().split("@");

  if (!localPart || !domain) {
    return "";
  }

  return domain;
}

/**
 * Normalizes the comma-separated domain list Better Auth allows on one
 * provider into individual domains.
 *
 * @param domainValue - The raw provider-domain string.
 */
function normalizeWorkspaceProviderDomains(domainValue: string): string[] {
  const domains = domainValue.split(",");
  const normalizedDomains: string[] = [];

  for (const domain of domains) {
    const normalizedDomain = domain.trim().toLowerCase();

    if (!normalizedDomain) {
      continue;
    }

    normalizedDomains.push(normalizedDomain);
  }

  return normalizedDomains;
}

/**
 * Chooses the explicit workspace-domain suggestion Atlas should prefill in the
 * SSO setup forms.
 *
 * Atlas first reuses an existing provider domain when the workspace is already
 * consistent. Otherwise it falls back to the signed-in operator's email
 * domain, keeping the suggestion visible and editable instead of hidden.
 *
 * @param params - The current workspace/provider context.
 * @param params.operatorEmail - The signed-in operator email address.
 * @param params.providers - The raw Better Auth SSO providers linked to the
 * workspace.
 */
function resolveWorkspaceDomainSuggestion(params: {
  operatorEmail: string;
  providers: z.infer<typeof rawWorkspaceSSOProviderListSchema>["providers"];
}): string {
  const uniqueDomains = new Set<string>();

  for (const provider of params.providers) {
    const normalizedDomains = normalizeWorkspaceProviderDomains(provider.domain);

    for (const normalizedDomain of normalizedDomains) {
      uniqueDomains.add(normalizedDomain);
    }
  }

  if (uniqueDomains.size === 1) {
    const [workspaceDomainSuggestion] = uniqueDomains;

    return workspaceDomainSuggestion ?? "";
  }

  return extractEmailDomain(params.operatorEmail);
}

/**
 * Builds the full workspace SSO state Atlas renders inside organization
 * management.
 *
 * @param params - The workspace and provider details to normalize.
 * @param params.organizationId - The active Better Auth organization id.
 * @param params.organizationSlug - The active workspace slug.
 * @param params.operatorEmail - The signed-in operator email address.
 * @param params.primaryProviderId - The workspace-level primary provider id.
 * @param params.providers - The raw Better Auth SSO providers.
 * @param params.publicBaseUrl - The public Atlas origin.
 */
export function buildWorkspaceSSOState(params: {
  organizationId: string;
  organizationSlug: string;
  operatorEmail: string;
  primaryHistory?: AtlasSsoPrimaryHistoryEntry[];
  primaryProviderId: string | null;
  providers: z.infer<typeof rawWorkspaceSSOProviderListSchema>["providers"];
  publicBaseUrl: string;
}): AtlasWorkspaceSSOState {
  const organizationProviders = params.providers.filter(
    (provider) => provider.organizationId === params.organizationId,
  );
  const providers = organizationProviders.map((provider) =>
    toAtlasWorkspaceSSOProvider(provider, params.primaryProviderId),
  );

  return {
    setup: buildWorkspaceSSOSetupValues({
      organizationSlug: params.organizationSlug,
      publicBaseUrl: params.publicBaseUrl,
      workspaceDomainSuggestion: resolveWorkspaceDomainSuggestion({
        operatorEmail: params.operatorEmail,
        providers: organizationProviders,
      }),
    }),
    primaryHistory: params.primaryHistory ?? [],
    primaryProviderId: params.primaryProviderId,
    providers,
  };
}

/**
 * Chooses the preferred provider Atlas should use for a workspace sign-in.
 *
 * Atlas honors an explicit primary provider first. When a workspace has not
 * chosen one yet, Atlas prefers a verified SAML provider before falling back
 * to the first verified provider. This keeps enterprise IdP routing explicit
 * without hardcoding any customer-specific workspace behavior.
 *
 * @param params - The provider-selection inputs.
 * @param params.domain - The operator's email domain, when known.
 * @param params.primaryProviderId - The workspace-level primary provider id.
 * @param params.providers - Candidate providers attached to the workspace.
 */
export function selectPreferredWorkspaceSSOProvider(params: {
  domain?: string | null;
  primaryProviderId: string | null;
  providers: AtlasWorkspaceSSOProvider[];
}): AtlasWorkspaceSSOProvider | null {
  const matchingProviders = params.domain
    ? params.providers.filter((provider) =>
        workspaceSSOProviderMatchesDomain(provider.domain, params.domain ?? ""),
      )
    : params.providers;
  const verifiedProviders = matchingProviders.filter((provider) => provider.domainVerified);
  const primaryProvider = verifiedProviders.find(
    (provider) => provider.providerId === params.primaryProviderId,
  );

  if (primaryProvider) {
    return primaryProvider;
  }

  const firstSamlProvider = verifiedProviders.find((provider) => provider.providerType === "saml");
  if (firstSamlProvider) {
    return firstSamlProvider;
  }

  return verifiedProviders[0] ?? null;
}
