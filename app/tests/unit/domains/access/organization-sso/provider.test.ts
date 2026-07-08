import { describe, expect, it } from "vitest";

import { buildOidcProvider, buildSamlProvider } from "./support";
import { toAtlasWorkspaceSSOProvider } from "@/domains/access/organization-sso";

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
