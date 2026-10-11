import { describe, expect, it } from "vitest";
import { getAuthConfig } from "@/domains/access/config";

describe("getAuthConfig", () => {
  it("defaults to the standard auth base path", () => {
    const config = getAuthConfig({});
    expect(config.authBasePath).toBe("/api/auth");
  });

  it("returns the api base url for an absolute public url", () => {
    expect(
      getAuthConfig({
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      }),
    ).toEqual({
      apiBaseUrl: "https://atlas.example.com/api",
      authBasePath: "/api/auth",
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
    });
  });
});

describe("getAuthConfig defaults", () => {
  it("uses default parameters", () => {
    expect(() => getAuthConfig()).not.toThrow();
  });
});
