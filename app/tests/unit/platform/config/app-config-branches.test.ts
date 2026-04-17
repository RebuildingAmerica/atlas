import { describe, expect, it } from "vitest";
import { getAbsoluteApiBaseUrl, getApiBaseUrl, getAppConfig } from "@/platform/config/app-config";

describe("app-config additional branches", () => {
  it("keeps an already-suffixed api public url unchanged", () => {
    expect(
      getApiBaseUrl({
        ATLAS_PUBLIC_URL: "https://atlas.example.com/api/",
      }),
    ).toBe("https://atlas.example.com/api");
  });

  it("uses absolute auth base paths as-is", () => {
    expect(
      getAppConfig({
        ATLAS_AUTH_BASE_PATH: "https://auth.atlas.test",
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      }),
    ).toEqual({
      apiBaseUrl: "https://atlas.example.com/api",
      authBasePath: "https://auth.atlas.test",
      authBaseUrl: "https://auth.atlas.test",
      localMode: false,
    });
  });

  it("requires either a public url or browser origin for browser-visible api calls", () => {
    expect(() => getAbsoluteApiBaseUrl()).toThrow(
      "ATLAS_PUBLIC_URL is required when the current browser origin is unavailable for browser-visible API calls.",
    );
  });
});
