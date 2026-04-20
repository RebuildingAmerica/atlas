import { describe, expect, it } from "vitest";
import {
  getAbsoluteApiBaseUrl,
  getApiBaseUrl,
  getAppConfig,
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

  it("rejects missing server-call origins", () => {
    expect(() => getServerApiBaseUrl({})).toThrow(
      "ATLAS_PUBLIC_URL is required for server-side Atlas API calls.",
    );
  });
});
