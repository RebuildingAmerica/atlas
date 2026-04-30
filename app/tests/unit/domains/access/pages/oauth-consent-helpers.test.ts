import { describe, expect, it } from "vitest";
import {
  isUrlShapedClientId,
  safeRedirectHostname,
  scopeAlreadyPinsOrg,
  withWorkspaceScope,
} from "@/domains/access/pages/auth/oauth-consent-helpers";

describe("safeRedirectHostname", () => {
  it("returns the host of a valid absolute URL", () => {
    expect(safeRedirectHostname("https://example.com/callback")).toBe("example.com");
    expect(safeRedirectHostname("https://example.com:8080/cb")).toBe("example.com:8080");
  });

  it("returns null for missing or invalid URIs", () => {
    expect(safeRedirectHostname(undefined)).toBeNull();
    expect(safeRedirectHostname("")).toBeNull();
    expect(safeRedirectHostname("not-a-url")).toBeNull();
  });
});

describe("isUrlShapedClientId", () => {
  it("returns true for URL-shaped client ids", () => {
    expect(isUrlShapedClientId("https://app.example.com/.well-known/oauth-client")).toBe(true);
  });

  it("returns false for opaque client ids", () => {
    expect(isUrlShapedClientId("opaque-client-id")).toBe(false);
    expect(isUrlShapedClientId("http://insecure")).toBe(false);
  });
});

describe("scopeAlreadyPinsOrg", () => {
  it("returns true when an org:{id} token is already present", () => {
    expect(scopeAlreadyPinsOrg("openid org:abc")).toBe(true);
    expect(scopeAlreadyPinsOrg("org:abc")).toBe(true);
  });

  it("returns false when no org token is present", () => {
    expect(scopeAlreadyPinsOrg("openid email profile")).toBe(false);
  });

  it("returns false for missing scope", () => {
    expect(scopeAlreadyPinsOrg(undefined)).toBe(false);
    expect(scopeAlreadyPinsOrg("")).toBe(false);
  });
});

describe("withWorkspaceScope", () => {
  it("returns the original scope when no workspace is selected", () => {
    expect(withWorkspaceScope("openid email", null)).toBe("openid email");
    expect(withWorkspaceScope(undefined, null)).toBe("");
  });

  it("returns the original scope when an org token is already pinned", () => {
    expect(withWorkspaceScope("openid org:abc", "xyz")).toBe("openid org:abc");
  });

  it("appends the workspace org token to a non-empty scope", () => {
    expect(withWorkspaceScope("openid email", "xyz")).toBe("openid email org:xyz");
  });

  it("returns the workspace org token alone when scope is empty", () => {
    expect(withWorkspaceScope(undefined, "xyz")).toBe("org:xyz");
    expect(withWorkspaceScope("", "xyz")).toBe("org:xyz");
  });
});
