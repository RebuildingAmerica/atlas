import { describe, expect, it } from "vitest";
import {
  getAbsoluteApiBaseUrl,
  getApiBaseUrl,
  getAppConfig,
  getServerApiBaseUrl,
} from "@/platform/config/app-config";

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
    });
  });

  it("requires either a public url or browser origin for browser-visible api calls", () => {
    expect(() => getAbsoluteApiBaseUrl({ env: {} })).toThrow(
      "ATLAS_PUBLIC_URL is required when the current browser origin is unavailable for browser-visible API calls.",
    );
  });

  it("rejects ATLAS_DOCS_URL values that don't parse as a URL", () => {
    expect(() =>
      getAppConfig({
        ATLAS_DOCS_URL: "https://[invalid",
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      }),
    ).toThrow("ATLAS_DOCS_URL must be a valid URL or hostname.");
  });

  it("uses an absolute proxy target verbatim for server-side api calls", () => {
    expect(
      getServerApiBaseUrl({
        ATLAS_SERVER_API_PROXY_TARGET: "https://api.internal.atlas.test",
      }),
    ).toBe("https://api.internal.atlas.test/api");
  });

  it("rejects a non-absolute server proxy target", () => {
    expect(() =>
      getServerApiBaseUrl({
        ATLAS_SERVER_API_PROXY_TARGET: "/relative-path",
      }),
    ).toThrow("ATLAS_SERVER_API_PROXY_TARGET must be an absolute URL.");
  });
});
