import { describe, expect, it } from "vitest";
import {
  permissionsToScopes,
  scopeToPermission,
  scopesToPermissions,
} from "@/domains/access/api-key-scopes";

describe("scopeToPermission", () => {
  it("splits an Atlas scope into resource and action", () => {
    expect(scopeToPermission("discovery:write")).toEqual(["discovery", "write"]);
  });
});

describe("scopesToPermissions", () => {
  it("deduplicates repeated actions under the same resource", () => {
    expect(
      scopesToPermissions([
        "discovery:read",
        "discovery:write",
        "discovery:read",
        "entities:write",
      ]),
    ).toEqual({
      discovery: ["read", "write"],
      entities: ["write"],
    });
  });
});

describe("permissionsToScopes", () => {
  it("returns no scopes when permissions are absent", () => {
    expect(permissionsToScopes(null)).toEqual([]);
    expect(permissionsToScopes(undefined)).toEqual([]);
  });

  it("filters Better Auth permissions down to supported Atlas scopes", () => {
    expect(
      permissionsToScopes({
        discovery: ["read", "write", "admin"],
        entities: ["write"],
        unknown: ["read"],
      }),
    ).toEqual(["discovery:read", "discovery:write", "entities:write"]);
  });
});
