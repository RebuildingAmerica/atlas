/* eslint-disable atlas-tests/no-test-file-locals */
import { describe, expect, it } from "vitest";
import {
  buildWorkspaceSSOSelectionProvider,
  buildWorkspaceSSOState,
  selectPreferredWorkspaceSSOProvider,
  toAtlasWorkspaceSSOProvider,
  type AtlasWorkspaceSSOProvider,
} from "@/domains/access/organization-sso";

interface RawWorkspaceSSOProvider {
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

function buildOidcProvider(
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

function buildSamlProvider(
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

describe("toAtlasWorkspaceSSOProvider", () => {
  it("normalizes a fully populated OIDC provider", () => {
    const result = toAtlasWorkspaceSSOProvider(buildOidcProvider(), "google-oidc");

    expect(result.providerType).toBe("oidc");
    expect(result.isPrimary).toBe(true);
    expect(result.oidc).toEqual({
      authorizationEndpoint: "https://accounts.google.com/auth",
      clientIdLastFour: "abcd",
      discoveryEndpoint: "https://accounts.google.com/.well-known/openid-configuration",
      jwksEndpoint: "https://accounts.google.com/jwks",
      pkce: true,
      scopes: ["openid", "email"],
      tokenEndpoint: "https://accounts.google.com/token",
      tokenEndpointAuthentication: "client_secret_basic",
      userInfoEndpoint: "https://accounts.google.com/userinfo",
    });
    expect(result.saml).toBeNull();
    expect(result.domainVerificationTokenAvailable).toBe(true);
    expect(result.domainVerificationHost).toContain("google-oidc");
  });

  it("defaults missing optional OIDC fields to null/empty", () => {
    const provider = buildOidcProvider({
      oidcConfig: {
        clientIdLastFour: "wxyz",
        discoveryEndpoint: "https://disc.example",
        pkce: false,
      },
    });
    const result = toAtlasWorkspaceSSOProvider(provider, null);

    expect(result.oidc).toEqual({
      authorizationEndpoint: null,
      clientIdLastFour: "wxyz",
      discoveryEndpoint: "https://disc.example",
      jwksEndpoint: null,
      pkce: false,
      scopes: [],
      tokenEndpoint: null,
      tokenEndpointAuthentication: null,
      userInfoEndpoint: null,
    });
    expect(result.isPrimary).toBe(false);
  });

  it("normalizes a SAML provider with a parseable certificate", () => {
    const result = toAtlasWorkspaceSSOProvider(buildSamlProvider(), "saml-1");

    expect(result.providerType).toBe("saml");
    expect(result.saml?.callbackUrl).toBe("https://atlas.test/acs");
    expect(result.saml?.certificate).toEqual({
      errorMessage: null,
      fingerprintSha256: "abc",
      notAfter: "2030-01-01",
      notBefore: "2020-01-01",
      publicKeyAlgorithm: "RSA",
    });
    expect(result.saml?.authnRequestsSigned).toBe(true);
    expect(result.isPrimary).toBe(true);
  });

  it("captures certificate parse errors as errorMessage", () => {
    const provider = buildSamlProvider({
      samlConfig: {
        callbackUrl: "https://atlas.test/acs",
        certificate: { error: "PEM is malformed" },
        entryPoint: "https://idp.atlas.test/sso",
      },
    });
    const result = toAtlasWorkspaceSSOProvider(provider, null);

    expect(result.saml?.certificate).toEqual({
      errorMessage: "PEM is malformed",
      fingerprintSha256: null,
      notAfter: null,
      notBefore: null,
      publicKeyAlgorithm: null,
    });
    expect(result.saml?.audience).toBeNull();
    expect(result.saml?.authnRequestsSigned).toBe(false);
    expect(result.saml?.wantAssertionsSigned).toBe(false);
  });
});

describe("buildWorkspaceSSOSelectionProvider", () => {
  it("returns an OIDC selection candidate", () => {
    const provider = buildWorkspaceSSOSelectionProvider({
      domain: "atlas.test",
      domainVerified: true,
      isPrimary: true,
      issuer: "https://accounts.google.com",
      organizationId: "org_1",
      providerId: "google-oidc",
      providerType: "oidc",
    });

    expect(provider.oidc).not.toBeNull();
    expect(provider.saml).toBeNull();
    expect(provider.domainVerificationTokenAvailable).toBe(false);
    expect(provider.spMetadataUrl).toBe("");
  });

  it("returns a SAML selection candidate", () => {
    const provider = buildWorkspaceSSOSelectionProvider({
      domain: "atlas.test",
      domainVerified: false,
      isPrimary: false,
      issuer: "https://idp.atlas.test",
      organizationId: null,
      providerId: "saml-1",
      providerType: "saml",
    });

    expect(provider.saml).not.toBeNull();
    expect(provider.oidc).toBeNull();
    expect(provider.saml?.callbackUrl).toBe("");
    expect(provider.saml?.entryPoint).toBe("");
    expect(provider.saml?.certificate.errorMessage).toBeNull();
  });
});

describe("buildWorkspaceSSOState", () => {
  it("filters providers to the requested workspace and reuses the unique provider domain", () => {
    const providers = [
      buildOidcProvider({ providerId: "p1", organizationId: "org_1", domain: "atlas.test" }),
      buildOidcProvider({ providerId: "p2", organizationId: "org_2", domain: "other.test" }),
    ];
    const state = buildWorkspaceSSOState({
      organizationId: "org_1",
      organizationSlug: "atlas",
      operatorEmail: "owner@unrelated.example",
      primaryProviderId: "p1",
      providers,
      publicBaseUrl: "https://atlas.test",
    });

    expect(state.providers).toHaveLength(1);
    expect(state.providers[0]?.providerId).toBe("p1");
    expect(state.primaryProviderId).toBe("p1");
    expect(state.primaryHistory).toEqual([]);
    expect(state.setup.workspaceDomainSuggestion).toBe("atlas.test");
  });

  it("falls back to operator email domain when no providers exist", () => {
    const state = buildWorkspaceSSOState({
      organizationId: "org_1",
      organizationSlug: "atlas",
      operatorEmail: "owner@example.org",
      primaryProviderId: null,
      providers: [],
      publicBaseUrl: "https://atlas.test/",
    });

    expect(state.setup.workspaceDomainSuggestion).toBe("example.org");
  });

  it("falls back to operator email when providers expose multiple domains", () => {
    const providers = [
      buildOidcProvider({ providerId: "p1", organizationId: "org_1", domain: "a.test, b.test" }),
    ];
    const state = buildWorkspaceSSOState({
      organizationId: "org_1",
      organizationSlug: "atlas",
      operatorEmail: "owner@fallback.test",
      primaryProviderId: null,
      providers,
      publicBaseUrl: "https://atlas.test",
    });

    expect(state.setup.workspaceDomainSuggestion).toBe("fallback.test");
  });

  it("returns empty suggestion when operator email is malformed", () => {
    const state = buildWorkspaceSSOState({
      organizationId: "org_1",
      organizationSlug: "atlas",
      operatorEmail: "no-at-sign",
      primaryProviderId: null,
      providers: [],
      publicBaseUrl: "https://atlas.test",
    });

    expect(state.setup.workspaceDomainSuggestion).toBe("");
  });

  it("preserves primaryHistory when provided", () => {
    const history = [{ changedAt: "2026-04-01", changedByEmail: "owner@a.test", providerId: "p1" }];
    const state = buildWorkspaceSSOState({
      organizationId: "org_1",
      organizationSlug: "atlas",
      operatorEmail: "owner@a.test",
      primaryHistory: history,
      primaryProviderId: "p1",
      providers: [],
      publicBaseUrl: "https://atlas.test",
    });

    expect(state.primaryHistory).toEqual(history);
  });

  it("ignores empty domain entries within a comma-separated provider domain", () => {
    const providers = [
      buildOidcProvider({ providerId: "p1", organizationId: "org_1", domain: " , atlas.test ,," }),
    ];
    const state = buildWorkspaceSSOState({
      organizationId: "org_1",
      organizationSlug: "atlas",
      operatorEmail: "owner@unrelated.example",
      primaryProviderId: null,
      providers,
      publicBaseUrl: "https://atlas.test",
    });

    expect(state.setup.workspaceDomainSuggestion).toBe("atlas.test");
  });
});

describe("selectPreferredWorkspaceSSOProvider", () => {
  function makeProvider(
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

  it("returns the workspace primary provider when available", () => {
    const providers = [
      makeProvider({ providerId: "p1", providerType: "oidc" }),
      makeProvider({ providerId: "p2", providerType: "saml" }),
    ];
    const result = selectPreferredWorkspaceSSOProvider({
      domain: "atlas.test",
      primaryProviderId: "p2",
      providers,
    });
    expect(result?.providerId).toBe("p2");
  });

  it("prefers a verified SAML provider when no primary is set", () => {
    const providers = [
      makeProvider({ providerId: "p1", providerType: "oidc" }),
      makeProvider({ providerId: "p2", providerType: "saml" }),
    ];
    const result = selectPreferredWorkspaceSSOProvider({
      domain: "atlas.test",
      primaryProviderId: null,
      providers,
    });
    expect(result?.providerId).toBe("p2");
  });

  it("falls back to the first verified provider when no SAML is configured", () => {
    const providers = [
      makeProvider({ providerId: "p1", providerType: "oidc" }),
      makeProvider({ providerId: "p2", providerType: "oidc" }),
    ];
    const result = selectPreferredWorkspaceSSOProvider({
      domain: "atlas.test",
      primaryProviderId: null,
      providers,
    });
    expect(result?.providerId).toBe("p1");
  });

  it("filters by email domain when provided", () => {
    const providers = [
      makeProvider({ providerId: "p1", providerType: "oidc", domain: "elsewhere.test" }),
      makeProvider({ providerId: "p2", providerType: "saml", domain: "atlas.test" }),
    ];
    const result = selectPreferredWorkspaceSSOProvider({
      domain: "atlas.test",
      primaryProviderId: null,
      providers,
    });
    expect(result?.providerId).toBe("p2");
  });

  it("returns null when nothing matches", () => {
    const result = selectPreferredWorkspaceSSOProvider({
      domain: "elsewhere.test",
      primaryProviderId: null,
      providers: [makeProvider({ domain: "atlas.test" })],
    });
    expect(result).toBeNull();
  });

  it("returns null when no providers are verified", () => {
    const result = selectPreferredWorkspaceSSOProvider({
      domain: undefined,
      primaryProviderId: null,
      providers: [makeProvider({ domainVerified: false })],
    });
    expect(result).toBeNull();
  });

  it("uses all providers when domain is null", () => {
    const providers = [makeProvider({ providerId: "p1", domain: "atlas.test" })];
    const result = selectPreferredWorkspaceSSOProvider({
      domain: null,
      primaryProviderId: null,
      providers,
    });
    expect(result?.providerId).toBe("p1");
  });
});
