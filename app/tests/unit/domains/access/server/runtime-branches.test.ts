import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAllowedEmail,
  resolveAuthRuntimeConfig,
  validateAuthRuntimeConfig,
} from "@/domains/access/server/runtime";

describe("runtime additional branches", () => {
  it("infers resend delivery when only the resend api key is configured", () => {
    const runtime = resolveAuthRuntimeConfig(
      {
        ATLAS_AUTH_INTERNAL_SECRET: "internal-test-secret",
        ATLAS_EMAIL_RESEND_API_KEY: "re_test_123",
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      },
      "/workspace/atlas/app",
    );

    expect(runtime.emailProvider).toBe("resend");
  });

  it("handles invalid URLs gracefully by returning null", () => {
    const runtime = resolveAuthRuntimeConfig(
      {
        ATLAS_AUTH_API_KEY_INTROSPECTION_URL: "not a url",
        ATLAS_SERVER_API_PROXY_TARGET: "also not a url",
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      },
      "/workspace",
    );

    expect(runtime.apiKeyIntrospectionUrl).toBeNull();
    expect(runtime.apiBaseUrl).toBeNull();
  });

  it("does not require enabled-mode settings when auth is disabled", () => {
    expect(() => {
      validateAuthRuntimeConfig({
        apiAudience: null,
        apiBaseUrl: null,
        allowedEmails: new Set(),
        apiKeyIntrospectionUrl: null,
        databaseUrl: null,
        localMode: true,
        openRegistration: true,
        captureUrl: null,
        dbPath: "/tmp/atlas-auth.sqlite",
        emailFrom: "Atlas <auth@atlas.test>",
        emailProvider: "capture",
        internalSecret: "internal-test-secret",
        passkeyRpId: null,
        publicBaseUrl: "https://atlas.test",
        publicDomain: "atlas.test",
        resendApiKey: null,
        samlAllowedIssuerOrigins: new Set(),
        samlSpPrivateKey: null,
        samlSpPrivateKeyPass: null,
        cimdAllowedHostSuffixes: [],
      });
    }).not.toThrow();
  });

  describe("when the operator allowlist is empty", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("blocks bootstrap access", () => {
      vi.stubEnv("ATLAS_PUBLIC_URL", "https://atlas.test");
      vi.stubEnv("ATLAS_AUTH_ALLOWED_EMAILS", "");

      expect(isAllowedEmail("anyone@atlas.test")).toBe(false);
    });
  });
});
