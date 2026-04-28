import { describe, expect, it } from "vitest";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  SUPPORTED_OAUTH_SCOPES,
} from "@/domains/access/oauth-as-metadata";

describe("buildAuthorizationServerMetadata", () => {
  it("derives every endpoint from the supplied public origin", () => {
    const metadata = buildAuthorizationServerMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(metadata.issuer).toBe("https://atlas.example/api/auth");
    expect(metadata.authorization_endpoint).toBe("https://atlas.example/api/auth/oauth2/authorize");
    expect(metadata.token_endpoint).toBe("https://atlas.example/api/auth/oauth2/token");
    expect(metadata.jwks_uri).toBe("https://atlas.example/api/auth/jwks");
  });

  it("advertises PKCE S256 as the only code-challenge method", () => {
    const metadata = buildAuthorizationServerMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("publishes the shared scope set", () => {
    const metadata = buildAuthorizationServerMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(metadata.scopes_supported).toEqual([...SUPPORTED_OAUTH_SCOPES]);
  });
});

describe("buildProtectedResourceMetadata", () => {
  it("publishes the canonical resource URI without a trailing slash", () => {
    const metadata = buildProtectedResourceMetadata({
      publicBaseUrl: "https://preview-pr-42.atlas.example",
    });

    expect(metadata.resource).toBe("https://preview-pr-42.atlas.example");
    expect(metadata.resource.endsWith("/")).toBe(false);
  });

  it("points clients at the in-repo authorization server", () => {
    const metadata = buildProtectedResourceMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(metadata.authorization_servers).toEqual(["https://atlas.example/api/auth"]);
  });

  it("declares header-only bearer token presentation", () => {
    const metadata = buildProtectedResourceMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(metadata.bearer_methods_supported).toEqual(["header"]);
  });

  it("publishes the same scope set as the AS metadata", () => {
    const asMetadata = buildAuthorizationServerMetadata({
      publicBaseUrl: "https://atlas.example",
    });
    const prmMetadata = buildProtectedResourceMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(prmMetadata.scopes_supported).toEqual(asMetadata.scopes_supported);
  });
});
