import { z } from "zod";
import {
  buildWorkspaceSSOSetupValues,
  buildWorkspaceSSODomainVerificationHost,
  workspaceSSOProviderMatchesDomain,
} from "./organization-sso-defaults";
import type { AtlasSsoPrimaryHistoryEntry } from "./organization-metadata";
import type {
  AtlasSAMLProviderCertificate,
  AtlasSSOProviderType,
  AtlasWorkspaceSSOProvider,
  AtlasWorkspaceSSOState,
} from "./organization-sso";

interface RawWorkspaceSSOProvider {
  domain: string;
  domainVerified: boolean;
  issuer: string;
  oidcConfig?:
    | {
        authorizationEndpoint?: string;
        clientIdLastFour: string;
        discoveryEndpoint: string;
        jwksEndpoint?: string;
        pkce: boolean;
        scopes?: string[];
        tokenEndpoint?: string;
        tokenEndpointAuthentication?: "client_secret_basic" | "client_secret_post";
        userInfoEndpoint?: string;
      }
    | undefined;
  organizationId: string | null;
  providerId: string;
  samlConfig?:
    | {
        audience?: string;
        authnRequestsSigned?: boolean;
        callbackUrl: string;
        certificate:
          | {
              fingerprintSha256: string;
              notAfter: string;
              notBefore: string;
              publicKeyAlgorithm: string;
            }
          | { error: string };
        digestAlgorithm?: string;
        entryPoint: string;
        identifierFormat?: string;
        signatureAlgorithm?: string;
        wantAssertionsSigned?: boolean;
      }
    | undefined;
  spMetadataUrl: string;
  type: string;
}

function toAtlasSamlCertificate(
  certificate:
    | {
        fingerprintSha256: string;
        notAfter: string;
        notBefore: string;
        publicKeyAlgorithm: string;
      }
    | { error: string },
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

export function toAtlasWorkspaceSSOProvider(
  provider: RawWorkspaceSSOProvider,
  primaryProviderId: string | null,
): AtlasWorkspaceSSOProvider {
  const providerType = z.enum(["oidc", "saml"]).parse(provider.type);
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
 * Builds a minimal provider candidate Atlas can use during pre-auth SSO routing.
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

function extractEmailDomain(email: string): string {
  const [localPart, domain] = email.trim().toLowerCase().split("@");
  if (!localPart || !domain) {
    return "";
  }
  return domain;
}

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

function resolveWorkspaceDomainSuggestion(params: {
  operatorEmail: string;
  providers: RawWorkspaceSSOProvider[];
}): string {
  const uniqueDomains = new Set<string>();

  for (const provider of params.providers) {
    const normalizedDomains = normalizeWorkspaceProviderDomains(provider.domain);
    for (const normalizedDomain of normalizedDomains) {
      uniqueDomains.add(normalizedDomain);
    }
  }

  const [firstDomain] = uniqueDomains;
  if (uniqueDomains.size === 1 && firstDomain !== undefined) {
    return firstDomain;
  }

  return extractEmailDomain(params.operatorEmail);
}

export function buildWorkspaceSSOState(params: {
  organizationId: string;
  organizationSlug: string;
  operatorEmail: string;
  primaryHistory?: AtlasSsoPrimaryHistoryEntry[];
  primaryProviderId: string | null;
  providers: RawWorkspaceSSOProvider[];
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

export function selectPreferredWorkspaceSSOProvider(params: {
  domain?: string | null;
  primaryProviderId: string | null;
  providers: AtlasWorkspaceSSOProvider[];
}): AtlasWorkspaceSSOProvider | null {
  const filterDomain = params.domain;
  const matchingProviders = filterDomain
    ? params.providers.filter((provider) =>
        workspaceSSOProviderMatchesDomain(provider.domain, filterDomain),
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
