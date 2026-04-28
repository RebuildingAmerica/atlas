import { describe, expect, it, vi } from "vitest";
import { buildAtlasAccessTokenClaims } from "@/domains/access/server/oauth-claims";

const DEFAULT_OPTIONS = {
  defaultAudience: "https://atlas.example/api",
} as const;

describe("buildAtlasAccessTokenClaims", () => {
  it("binds the access token's `aud` claim to the resource parameter (RFC 8707)", async () => {
    const claims = await buildAtlasAccessTokenClaims(
      {
        scopes: ["discovery:read"],
        resource: "https://atlas.example/mcp",
      },
      DEFAULT_OPTIONS,
    );

    expect(claims.aud).toBe("https://atlas.example/mcp");
  });

  it("falls back to the configured default audience when no resource is supplied", async () => {
    const claims = await buildAtlasAccessTokenClaims(
      { scopes: ["discovery:read"] },
      DEFAULT_OPTIONS,
    );

    expect(claims.aud).toBe(DEFAULT_OPTIONS.defaultAudience);
  });

  it("omits the `aud` claim when neither a resource nor a default audience is available", async () => {
    const claims = await buildAtlasAccessTokenClaims(
      { scopes: ["discovery:read"] },
      { defaultAudience: null },
    );

    expect(claims.aud).toBeUndefined();
  });

  it("translates Atlas resource scopes into the permissions map", async () => {
    const claims = await buildAtlasAccessTokenClaims(
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

  it("encodes the org_id from `org:{id}` scopes", async () => {
    const claims = await buildAtlasAccessTokenClaims(
      {
        scopes: ["openid", "org:org_42"],
        resource: "https://atlas.example/api",
      },
      DEFAULT_OPTIONS,
    );

    expect(claims.org_id).toBe("org_42");
  });

  it("does not bleed non-Atlas scopes into the permissions map", async () => {
    const claims = await buildAtlasAccessTokenClaims(
      {
        scopes: ["openid", "email", "profile"],
        resource: "https://atlas.example/api",
      },
      DEFAULT_OPTIONS,
    );

    expect(claims.permissions).toEqual({});
  });

  it("falls back to the user's primary workspace when no org: scope is requested", async () => {
    const resolvePrimaryWorkspaceId = vi.fn().mockResolvedValue("ws_solo");

    const claims = await buildAtlasAccessTokenClaims(
      {
        scopes: ["openid", "discovery:read"],
        resource: "https://atlas.example/mcp",
        user: { id: "user_123" },
      },
      { ...DEFAULT_OPTIONS, resolvePrimaryWorkspaceId },
    );

    expect(resolvePrimaryWorkspaceId).toHaveBeenCalledWith("user_123");
    expect(claims.org_id).toBe("ws_solo");
  });

  it("does not fall back when the client requested an explicit org: scope", async () => {
    const resolvePrimaryWorkspaceId = vi.fn().mockResolvedValue("ws_solo");

    const claims = await buildAtlasAccessTokenClaims(
      {
        scopes: ["openid", "org:ws_chosen"],
        user: { id: "user_123" },
      },
      { ...DEFAULT_OPTIONS, resolvePrimaryWorkspaceId },
    );

    expect(resolvePrimaryWorkspaceId).not.toHaveBeenCalled();
    expect(claims.org_id).toBe("ws_chosen");
  });

  it("omits org_id when the user has zero or multiple workspaces", async () => {
    const resolvePrimaryWorkspaceId = vi.fn().mockResolvedValue(null);

    const claims = await buildAtlasAccessTokenClaims(
      {
        scopes: ["openid", "discovery:read"],
        user: { id: "user_123" },
      },
      { ...DEFAULT_OPTIONS, resolvePrimaryWorkspaceId },
    );

    expect(resolvePrimaryWorkspaceId).toHaveBeenCalledWith("user_123");
    expect(claims.org_id).toBeUndefined();
  });

  it("does not query the lookup when no user id is in the payload", async () => {
    const resolvePrimaryWorkspaceId = vi.fn();

    const claims = await buildAtlasAccessTokenClaims(
      { scopes: ["openid"] },
      { ...DEFAULT_OPTIONS, resolvePrimaryWorkspaceId },
    );

    expect(resolvePrimaryWorkspaceId).not.toHaveBeenCalled();
    expect(claims.org_id).toBeUndefined();
  });
});
