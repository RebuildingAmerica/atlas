import { describe, expect, it } from "vitest";
import {
  getAbsoluteApiBaseUrl,
  getApiBaseUrl,
  getAppConfig,
  getDocsUrl,
  getServerApiBaseUrl,
} from "@/platform/config/app-config";

describe("getApiBaseUrl", () => {
  it("uses the configured public origin when present", () => {
    expect(
      getApiBaseUrl({
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      }),
    ).toBe("https://atlas.example.com/api");
  });

  it("normalizes a configured public origin with trailing slashes", () => {
    expect(
      getApiBaseUrl({
        ATLAS_PUBLIC_URL: "https://atlas.example.com/",
      }),
    ).toBe("https://atlas.example.com/api");
  });

  it("rejects relative public origins", () => {
    expect(() =>
      getApiBaseUrl({
        ATLAS_PUBLIC_URL: "/api",
      }),
    ).toThrow("ATLAS_PUBLIC_URL must be an absolute URL.");
  });

  it("rejects missing configured Atlas API origins", () => {
    expect(() => getApiBaseUrl({})).toThrow(
      "ATLAS_PUBLIC_URL is required for configured Atlas API calls.",
    );
  });

  it("handles empty public url string", () => {
    expect(() => getApiBaseUrl({ ATLAS_PUBLIC_URL: "  " })).toThrow("ATLAS_PUBLIC_URL is required");
  });

  it("normalizes origins without api suffix", () => {
    expect(getApiBaseUrl({ ATLAS_PUBLIC_URL: "https://atlas.test" })).toBe(
      "https://atlas.test/api",
    );
  });

  it("handles multiple trailing slashes", () => {
    expect(getApiBaseUrl({ ATLAS_PUBLIC_URL: "https://atlas.test///" })).toBe(
      "https://atlas.test/api",
    );
  });
});

describe("getAppConfig", () => {
  it("defaults to auth enabled when ATLAS_DEPLOY_MODE is not set", () => {
    expect(getAppConfig({})).toEqual({
      authBasePath: "/api/auth",
      localMode: false,
    });
  });

  it("enables local mode when ATLAS_DEPLOY_MODE is local", () => {
    expect(getAppConfig({ ATLAS_DEPLOY_MODE: "local" })).toEqual({
      authBasePath: "/api/auth",
      localMode: true,
    });
  });

  it("supports an absolute auth base path", () => {
    expect(getAppConfig({ ATLAS_AUTH_BASE_PATH: "https://auth.example.com" })).toEqual({
      authBasePath: "https://auth.example.com",
      authBaseUrl: "https://auth.example.com",
      localMode: false,
    });
  });

  it("resolves a custom relative auth path against the public url", () => {
    expect(
      getAppConfig({
        ATLAS_AUTH_BASE_PATH: "/custom-auth",
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      }),
    ).toEqual({
      apiBaseUrl: "https://atlas.example.com/api",
      authBasePath: "/custom-auth",
      authBaseUrl: "https://atlas.example.com/custom-auth",
      localMode: false,
    });
  });

  it("does not resolve authBaseUrl when using default auth path", () => {
    expect(
      getAppConfig({ ATLAS_PUBLIC_URL: "https://atlas.example.com" }).authBaseUrl,
    ).toBeUndefined();
  });

  it("does not resolve authBaseUrl when public url is missing", () => {
    expect(getAppConfig({ ATLAS_AUTH_BASE_PATH: "/custom" }).authBaseUrl).toBeUndefined();
  });

  it("normalizes a bare Mintlify hostname to an https origin", () => {
    expect(
      getAppConfig({
        ATLAS_DOCS_URL: "rebuildingamericaproject.mintlify.dev/",
      }),
    ).toEqual({
      authBasePath: "/api/auth",
      docsUrl: "https://rebuildingamericaproject.mintlify.dev",
      localMode: false,
    });
  });

  it("rejects non-absolute public urls", () => {
    expect(() => getAppConfig({ ATLAS_PUBLIC_URL: "relative/path" })).toThrow(
      "ATLAS_PUBLIC_URL must be an absolute URL.",
    );
  });

  it("rejects invalid docs urls", () => {
    expect(() => getAppConfig({ ATLAS_DOCS_URL: "not a url??" })).toThrow(
      "ATLAS_DOCS_URL must be a valid URL or hostname.",
    );
  });

  it("handles missing origin in getAbsoluteApiBaseUrl", () => {
    expect(() => getAbsoluteApiBaseUrl({ env: {}, origin: "" })).toThrow(
      "ATLAS_PUBLIC_URL is required when the current browser origin is unavailable",
    );
  });

  it("resolves default API base URL when no public URL is provided", () => {
    expect(getAbsoluteApiBaseUrl({ env: {}, origin: "https://local.test" })).toBe(
      "https://local.test/api",
    );
  });
});

describe("getAbsoluteApiBaseUrl", () => {
  it("resolves a relative API path against the current browser origin", () => {
    expect(
      getAbsoluteApiBaseUrl({
        env: {},
        origin: "https://atlas.example.com",
      }),
    ).toBe("https://atlas.example.com/api");
  });

  it("normalizes an already-suffixed origin", () => {
    expect(
      getAbsoluteApiBaseUrl({
        env: {},
        origin: "https://atlas.example.com/api",
      }),
    ).toBe("https://atlas.example.com/api");
  });

  it("uses the configured public app url when provided", () => {
    expect(
      getAbsoluteApiBaseUrl({
        env: {
          ATLAS_PUBLIC_URL: "https://atlas.example.com",
        },
      }),
    ).toBe("https://atlas.example.com/api");
  });
});

describe("getServerApiBaseUrl", () => {
  it("uses the public origin for server-side Atlas API calls", () => {
    expect(
      getServerApiBaseUrl({
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      }),
    ).toBe("https://atlas.example.com/api");
  });

  it("handles default env in getServerApiBaseUrl", () => {
    const originalUrl = process.env.ATLAS_PUBLIC_URL;
    process.env.ATLAS_PUBLIC_URL = "https://default.test";
    try {
      expect(getServerApiBaseUrl()).toBe("https://default.test/api");
    } finally {
      process.env.ATLAS_PUBLIC_URL = originalUrl;
    }
  });

  it("rejects missing server-call origins", () => {
    expect(() => getServerApiBaseUrl({})).toThrow(
      "ATLAS_PUBLIC_URL or ATLAS_SERVER_API_PROXY_TARGET is required for server-side Atlas API calls.",
    );
  });
});

describe("default exports and parameters", () => {
  it("getAppConfig returns localMode false for empty env", () => {
    const config = getAppConfig({});
    expect(config.localMode).toBe(false);
    expect(config.authBasePath).toBe("/api/auth");
  });

  it("getAbsoluteApiBaseUrl falls back to origin", () => {
    expect(getAbsoluteApiBaseUrl({ env: {}, origin: "http://localhost" })).toBe(
      "http://localhost/api",
    );
  });

  it("getDocsUrl normalizes a bare hostname", () => {
    expect(getDocsUrl({ ATLAS_DOCS_URL: "rebuildingamericaproject.mintlify.dev" })).toBe(
      "https://rebuildingamericaproject.mintlify.dev",
    );
  });
});
