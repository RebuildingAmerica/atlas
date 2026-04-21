import { describe, expect, it } from "vitest";
import { createInternalAuthHeaders, getAuthConfig } from "@/domains/access/config";

describe("getAuthConfig", () => {
  it("defaults to auth enabled without local mode", () => {
    const config = getAuthConfig({});
    expect(config.authBasePath).toBe("/api/auth");
    expect(config.localMode).toBe(false);
  });

  it("returns localMode false when ATLAS_DEPLOY_MODE is not local", () => {
    expect(
      getAuthConfig({
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      }),
    ).toEqual({
      apiBaseUrl: "https://atlas.example.com/api",
      authBasePath: "/api/auth",
      localMode: false,
    });
  });

  it("builds an absolute auth URL when auth base is explicitly overridden", () => {
    expect(
      getAuthConfig({
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
        ATLAS_AUTH_BASE_PATH: "/custom-auth",
      }),
    ).toEqual({
      apiBaseUrl: "https://atlas.example.com/api",
      authBasePath: "/custom-auth",
      authBaseUrl: "https://atlas.example.com/custom-auth",
      localMode: false,
    });
  });
});

describe("createInternalAuthHeaders", () => {
  it("builds trusted actor headers for app-to-api calls", () => {
    expect(
      createInternalAuthHeaders(
        {
          email: "operator@example.com",
          id: "user_123",
        },
        "internal-test-secret",
      ),
    ).toEqual({
      "X-Atlas-Actor-Email": "operator@example.com",
      "X-Atlas-Actor-Id": "user_123",
      "X-Atlas-Internal-Secret": "internal-test-secret",
    });
  });

  it("includes organization id when provided", () => {
    expect(
      createInternalAuthHeaders({ email: "a@b.com", id: "u1" }, "s", { organizationId: "org_1" }),
    ).toEqual({
      "X-Atlas-Actor-Email": "a@b.com",
      "X-Atlas-Actor-Id": "u1",
      "X-Atlas-Internal-Secret": "s",
      "X-Atlas-Organization-Id": "org_1",
    });
  });
});

describe("getAuthConfig defaults", () => {
  it("uses default parameters", () => {
    expect(() => getAuthConfig()).not.toThrow();
  });
});
