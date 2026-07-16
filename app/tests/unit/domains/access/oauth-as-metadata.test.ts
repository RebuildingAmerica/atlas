import { describe, expect, it } from "vitest";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  SUPPORTED_OAUTH_SCOPES,
} from "@rebuildingamerica/atlas-access/oauth-as-metadata";

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

  it("advertises the canonical MCP protected resource for authorization-server discovery", () => {
    const metadata = buildAuthorizationServerMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(metadata.protected_resources).toEqual(["https://atlas.example/mcp"]);
  });

  it("advertises RFC 9207 authorization response issuer support", () => {
    const metadata = buildAuthorizationServerMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(metadata.authorization_response_iss_parameter_supported).toBe(true);
  });
});

describe("buildProtectedResourceMetadata", () => {
  it("publishes the canonical MCP resource URI without a trailing slash", () => {
    const metadata = buildProtectedResourceMetadata({
      publicBaseUrl: "https://preview-pr-42.atlas.example",
    });

    expect(metadata.resource).toBe("https://preview-pr-42.atlas.example/mcp");
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

  it("publishes only the minimal MCP baseline scope", () => {
    const asMetadata = buildAuthorizationServerMetadata({
      publicBaseUrl: "https://atlas.example",
    });
    const prmMetadata = buildProtectedResourceMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(asMetadata.scopes_supported).toContain("offline_access");
    expect(asMetadata.scopes_supported).toContain("discovery:write");
    expect(asMetadata.scopes_supported).toContain("api.mcp");
    expect(prmMetadata.scopes_supported).toEqual(["discovery:read", "api.mcp"]);
    expect(prmMetadata.scopes_supported).not.toContain("offline_access");
    expect(prmMetadata.scopes_supported).not.toContain("discovery:write");
  });
});
