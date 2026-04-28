import { describe, expect, it } from "vitest";
import { buildAtlasAccessTokenClaims } from "@/domains/access/server/oauth-claims";

const DEFAULT_OPTIONS = { defaultAudience: "https://atlas.example/api" } as const;

describe("buildAtlasAccessTokenClaims", () => {
  it("binds the access token's `aud` claim to the resource parameter (RFC 8707)", () => {
    const claims = buildAtlasAccessTokenClaims(
      {
        scopes: ["discovery:read"],
        resource: "https://atlas.example/mcp",
      },
      DEFAULT_OPTIONS,
    );

    expect(claims.aud).toBe("https://atlas.example/mcp");
  });

  it("falls back to the configured default audience when no resource is supplied", () => {
    const claims = buildAtlasAccessTokenClaims({ scopes: ["discovery:read"] }, DEFAULT_OPTIONS);

    expect(claims.aud).toBe(DEFAULT_OPTIONS.defaultAudience);
  });

  it("omits the `aud` claim when neither a resource nor a default audience is available", () => {
    const claims = buildAtlasAccessTokenClaims(
      { scopes: ["discovery:read"] },
      { defaultAudience: null },
    );

    expect(claims.aud).toBeUndefined();
  });

  it("translates Atlas resource scopes into the permissions map", () => {
    const claims = buildAtlasAccessTokenClaims(
      {
        scopes: ["discovery:read", "entities:write", "openid"],
        resource: "https://atlas.example/api",
      },
      DEFAULT_OPTIONS,
    );

    expect(claims.permissions).toEqual({
      discovery: ["read"],
      entities: ["write"],
    });
  });

  it("encodes the org_id from `org:{id}` scopes", () => {
    const claims = buildAtlasAccessTokenClaims(
      {
        scopes: ["openid", "org:org_42"],
        resource: "https://atlas.example/api",
      },
      DEFAULT_OPTIONS,
    );

    expect(claims.org_id).toBe("org_42");
  });

  it("does not bleed non-Atlas scopes into the permissions map", () => {
    const claims = buildAtlasAccessTokenClaims(
      { scopes: ["openid", "email", "profile"], resource: "https://atlas.example/api" },
      DEFAULT_OPTIONS,
    );

    expect(claims.permissions).toEqual({});
  });
});
