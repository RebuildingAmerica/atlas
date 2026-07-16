import { describe, expect, it } from "vitest";
import {
  permissionsToScopes,
  scopeToPermission,
  scopesToPermissions,
} from "@rebuildingamerica/atlas-access/api-key-scopes";

describe("scopeToPermission", () => {
  it("splits an Atlas scope into resource and action", () => {
    expect(scopeToPermission("firehose:read")).toEqual(["firehose", "read"]);
  });
});

describe("scopesToPermissions", () => {
  it("deduplicates repeated actions under the same resource", () => {
    expect(
      scopesToPermissions([
        "discovery:read",
        "discovery:write",
        "firehose:read",
        "discovery:read",
        "entities:write",
      ]),
    ).toEqual({
      discovery: ["read", "write"],
      entities: ["write"],
      firehose: ["read"],
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
        firehose: ["read"],
        unknown: ["read"],
      }),
    ).toEqual(["discovery:read", "discovery:write", "entities:write", "firehose:read"]);
  });
});
