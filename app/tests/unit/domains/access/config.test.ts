import { describe, expect, it, vi } from "vitest";
import { getAuthConfig } from "@/domains/access/config";

describe("getAuthConfig", () => {
  it("keeps custom sign-in and API URLs on the current migration hostname", () => {
    const env = {
      ATLAS_WEB_CANONICAL_URL: "https://atlas.example.com",
      ATLAS_PUBLIC_URL: "https://atlas.example.com",
      ATLAS_AUTH_BASE_PATH: "/custom-auth",
    };
    for (const origin of ["https://candidate.atlas.example.com", "https://atlas.example.com"]) {
      vi.stubGlobal("window", { location: { origin } });
      try {
        expect(getAuthConfig(env)).toMatchObject({
          apiBaseUrl: `${origin}/api`,
          authBaseUrl: `${origin}/custom-auth`,
        });
        expect(
          getAuthConfig({ ...env, ATLAS_AUTH_BASE_PATH: "https://atlas.example.com/custom-auth" })
            .authBaseUrl,
        ).toBe(`${origin}/custom-auth`);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it("retains server and explicitly external auth configuration", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(
        getAuthConfig({
          ATLAS_WEB_CANONICAL_URL: "https://atlas.example.com",
          ATLAS_PUBLIC_URL: "https://atlas.example.com",
          ATLAS_AUTH_BASE_PATH: "/custom-auth",
        }).authBaseUrl,
      ).toBe("https://atlas.example.com/custom-auth");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(
      getAuthConfig({
        ATLAS_WEB_CANONICAL_URL: "https://atlas.example.com",
        ATLAS_AUTH_BASE_PATH: "https://identity.example.com/auth",
      }).authBaseUrl,
    ).toBe("https://identity.example.com/auth");
  });
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
