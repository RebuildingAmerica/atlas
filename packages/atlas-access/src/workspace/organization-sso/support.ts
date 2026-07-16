import type { AtlasWorkspaceSSOProvider } from "../organization-sso";

export interface RawWorkspaceSSOProvider {
  domain: string;
  domainVerified: boolean;
  issuer: string;
  oidcConfig?: {
    authorizationEndpoint?: string;
    clientIdLastFour: string;
    discoveryEndpoint: string;
    jwksEndpoint?: string;
    pkce: boolean;
    scopes?: string[];
    tokenEndpoint?: string;
    tokenEndpointAuthentication?: "client_secret_basic" | "client_secret_post";
    userInfoEndpoint?: string;
  };
  organizationId: string | null;
  providerId: string;
  samlConfig?: {
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
  };
  spMetadataUrl: string;
  type: string;
}

export function buildOidcProvider(
  overrides: Partial<RawWorkspaceSSOProvider> = {},
): RawWorkspaceSSOProvider {
  return {
    domain: "atlas.test",
    domainVerified: true,
    issuer: "https://accounts.google.com",
    oidcConfig: {
      authorizationEndpoint: "https://accounts.google.com/auth",
      clientIdLastFour: "abcd",
      discoveryEndpoint: "https://accounts.google.com/.well-known/openid-configuration",
      jwksEndpoint: "https://accounts.google.com/jwks",
      pkce: true,
      scopes: ["openid", "email"],
      tokenEndpoint: "https://accounts.google.com/token",
      tokenEndpointAuthentication: "client_secret_basic",
      userInfoEndpoint: "https://accounts.google.com/userinfo",
    },
    organizationId: "org_1",
    providerId: "google-oidc",
    spMetadataUrl: "https://atlas.test/metadata",
    type: "oidc",
    ...overrides,
  };
}

export function buildSamlProvider(
  overrides: Partial<RawWorkspaceSSOProvider> = {},
): RawWorkspaceSSOProvider {
  return {
    domain: "atlas.test",
    domainVerified: false,
    issuer: "https://idp.atlas.test",
    organizationId: "org_1",
    providerId: "saml-1",
    samlConfig: {
      audience: "https://atlas.test/audience",
      authnRequestsSigned: true,
      callbackUrl: "https://atlas.test/acs",
      certificate: {
        fingerprintSha256: "abc",
        notAfter: "2030-01-01",
        notBefore: "2020-01-01",
        publicKeyAlgorithm: "RSA",
      },
      digestAlgorithm: "sha256",
      entryPoint: "https://idp.atlas.test/sso",
      identifierFormat: "email",
      signatureAlgorithm: "rsa-sha256",
      wantAssertionsSigned: true,
    },
    spMetadataUrl: "https://atlas.test/sp-metadata",
    type: "saml",
    ...overrides,
  };
}

export function makeAtlasWorkspaceSSOProvider(
  overrides: Partial<AtlasWorkspaceSSOProvider> = {},
): AtlasWorkspaceSSOProvider {
  return {
    domain: "atlas.test",
    domainVerificationHost: "host",
    domainVerificationTokenAvailable: false,
    domainVerified: true,
    isPrimary: false,
    issuer: "https://idp.atlas.test",
    oidc: null,
    organizationId: "org_1",
    providerId: "p1",
    providerType: "oidc",
    saml: null,
    spMetadataUrl: "",
    ...overrides,
  };
}
