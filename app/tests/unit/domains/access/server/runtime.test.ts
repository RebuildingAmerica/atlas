import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  sanitizeBrowserSessionHeaders,
  resolveAuthRuntimeConfig,
  validateAuthRuntimeConfig,
} from "@/domains/access/server/runtime";

describe("resolveAuthRuntimeConfig", () => {
  it("requires a public Atlas origin and derives the auth domain from it", () => {
    const runtime = resolveAuthRuntimeConfig(
      {
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      },
      "/workspace/atlas/app",
    );

    expect(runtime.publicDomain).toBe("atlas.example.com");
    expect(runtime.publicBaseUrl).toBe("https://atlas.example.com");
    expect(runtime.apiBaseUrl).toBeNull();
    expect(runtime.apiKeyIntrospectionUrl).toBeNull();
    expect(runtime.dbPath).toBe(
      path.join("/workspace/atlas/app", "data", "auth", "atlas-auth.sqlite"),
    );
  });

  it("rejects missing public origins", () => {
    expect(() => resolveAuthRuntimeConfig({}, "/workspace/atlas/app")).toThrow(
      "ATLAS_PUBLIC_URL is required.",
    );
  });

  it("honors explicit auth runtime overrides", () => {
    const runtime = resolveAuthRuntimeConfig(
      {
        ATLAS_EMAIL_CAPTURE_URL: "http://127.0.0.1:8025/messages",
        ATLAS_EMAIL_FROM: "Atlas Ops <auth@atlas.example.com>",
        ATLAS_EMAIL_PROVIDER: "capture",
        ATLAS_AUTH_ALLOWED_EMAILS: "operator@example.com, editor@example.com ",
        ATLAS_AUTH_API_KEY_INTROSPECTION_URL: "http://127.0.0.1:3100/api/auth/internal/api-key",
        ATLAS_AUTH_DB_PATH: "/srv/atlas/auth/atlas.sqlite",
        ATLAS_AUTH_INTERNAL_SECRET: "internal-test-secret",
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
        ATLAS_SERVER_API_PROXY_TARGET: "http://127.0.0.1:38000",
      },
      "/workspace/atlas/app",
    );

    expect(runtime.allowedEmails).toEqual(new Set(["operator@example.com", "editor@example.com"]));
    expect(runtime.apiBaseUrl).toBe("http://127.0.0.1:38000");
    expect(runtime.apiKeyIntrospectionUrl).toBe("http://127.0.0.1:3100/api/auth/internal/api-key");
    expect(runtime.localMode).toBe(false);
    expect(runtime.dbPath).toBe("/srv/atlas/auth/atlas.sqlite");
    expect(runtime.captureUrl).toBe("http://127.0.0.1:8025/messages");
    expect(runtime.emailProvider).toBe("capture");
    expect(runtime.emailFrom).toBe("Atlas Ops <auth@atlas.example.com>");
    expect(runtime.internalSecret).toBe("internal-test-secret");
  });

  it("supports resend config for auth-enabled deployments", () => {
    const runtime = resolveAuthRuntimeConfig(
      {
        ATLAS_AUTH_INTERNAL_SECRET: "internal-test-secret",
        ATLAS_AUTH_API_KEY_INTROSPECTION_URL: "http://127.0.0.1:3100/api/auth/internal/api-key",

        ATLAS_EMAIL_PROVIDER: "resend",
        ATLAS_EMAIL_RESEND_API_KEY: "re_test_123",
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      },
      "/workspace/atlas/app",
    );

    expect(runtime.emailProvider).toBe("resend");
    expect(runtime.resendApiKey).toBe("re_test_123");
    expect(() => {
      validateAuthRuntimeConfig(runtime);
    }).not.toThrow();
  });

  it("rejects auth-enabled deployments without an explicit introspection url", () => {
    const runtime = resolveAuthRuntimeConfig(
      {
        ATLAS_AUTH_INTERNAL_SECRET: "internal-test-secret",

        ATLAS_EMAIL_PROVIDER: "resend",
        ATLAS_EMAIL_RESEND_API_KEY: "re_test_123",
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      },
      "/workspace/atlas/app",
    );

    expect(() => {
      validateAuthRuntimeConfig(runtime);
    }).toThrow(
      "ATLAS_AUTH_API_KEY_INTROSPECTION_URL is required when ATLAS_DEPLOY_MODE is not local.",
    );
  });

  it("rejects auth-enabled capture email without a capture url", () => {
    const runtime = resolveAuthRuntimeConfig(
      {
        ATLAS_AUTH_INTERNAL_SECRET: "internal-test-secret",
        ATLAS_AUTH_API_KEY_INTROSPECTION_URL: "http://127.0.0.1:3100/api/auth/internal/api-key",

        ATLAS_EMAIL_PROVIDER: "capture",
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      },
      "/workspace/atlas/app",
    );

    expect(() => {
      validateAuthRuntimeConfig(runtime);
    }).toThrow("ATLAS_EMAIL_CAPTURE_URL is required when ATLAS_EMAIL_PROVIDER=capture.");
  });

  it("rejects auth-enabled resend email without an api key", () => {
    const runtime = resolveAuthRuntimeConfig(
      {
        ATLAS_AUTH_INTERNAL_SECRET: "internal-test-secret",
        ATLAS_AUTH_API_KEY_INTROSPECTION_URL: "http://127.0.0.1:3100/api/auth/internal/api-key",

        ATLAS_EMAIL_PROVIDER: "resend",
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      },
      "/workspace/atlas/app",
    );

    expect(() => {
      validateAuthRuntimeConfig(runtime);
    }).toThrow("ATLAS_EMAIL_RESEND_API_KEY is required when ATLAS_EMAIL_PROVIDER=resend.");
  });

  it("rejects missing auth secrets", () => {
    const runtime = resolveAuthRuntimeConfig(
      {
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      },
      "/workspace/atlas/app",
    );

    expect(() => {
      validateAuthRuntimeConfig(runtime);
    }).toThrow("ATLAS_AUTH_INTERNAL_SECRET is required.");
  });
});

describe("getBrowserSessionHeaders", () => {
  it("only forwards browser session cookies and strips api-key style headers", () => {
    const headers = sanitizeBrowserSessionHeaders(
      new Headers({
        cookie: "session=abc123",
        "x-api-key": "atlas_secret_key",
        "x-atlas-internal-secret": "internal-test-secret",
      }),
    );

    expect(headers.get("cookie")).toBe("session=abc123");
    expect(headers.get("x-api-key")).toBeNull();
    expect(headers.get("x-atlas-internal-secret")).toBeNull();
  });

  it("returns an empty header set when the request has no browser session cookie", () => {
    const headers = sanitizeBrowserSessionHeaders(
      new Headers({
        "x-api-key": "atlas_secret_key",
      }),
    );

    expect(Array.from(headers.entries())).toEqual([]);
  });
});
