import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAllowedEmail,
  resolveAuthRuntimeConfig,
  validateAuthRuntimeConfig,
} from "@/domains/access/server/runtime";

describe("runtime additional branches", () => {
  const loadFreshRuntime = async (env: Record<string, string>) => {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    return await import("@/domains/access/server/runtime");
  };

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

  describe("operator allowlist with entries", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("admits the listed emails and rejects others", async () => {
      const runtime = await loadFreshRuntime({
        ATLAS_PUBLIC_URL: "https://atlas.test",
        ATLAS_AUTH_INTERNAL_SECRET: "internal",
        ATLAS_AUTH_ALLOWED_EMAILS: "ops@atlas.test, ROOT@atlas.test",
      });

      expect(runtime.isAllowedEmail("ops@atlas.test")).toBe(true);
      expect(runtime.isAllowedEmail(" Root@Atlas.Test ")).toBe(true);
      expect(runtime.isAllowedEmail("intruder@atlas.test")).toBe(false);
    });
  });

  describe("SAML issuer allowlist", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("rejects every issuer when the allowlist is empty", async () => {
      const runtime = await loadFreshRuntime({
        ATLAS_PUBLIC_URL: "https://atlas.test",
        ATLAS_AUTH_INTERNAL_SECRET: "internal",
        ATLAS_SAML_ALLOWED_ISSUERS: "",
      });

      expect(runtime.isAllowedSamlIssuer("https://idp.example.com/saml2")).toBe(false);
      expect(runtime.getSamlAllowedIssuerOrigins()).toEqual([]);
    });

    it("matches by URL origin and ignores query parameters", async () => {
      const runtime = await loadFreshRuntime({
        ATLAS_PUBLIC_URL: "https://atlas.test",
        ATLAS_AUTH_INTERNAL_SECRET: "internal",
        ATLAS_SAML_ALLOWED_ISSUERS: "https://accounts.google.com, https://login.microsoft.com",
      });

      expect(runtime.isAllowedSamlIssuer("https://accounts.google.com/o/saml2?idpid=abc")).toBe(
        true,
      );
      expect(runtime.isAllowedSamlIssuer("https://login.microsoft.com/saml2/path")).toBe(true);
      expect(runtime.isAllowedSamlIssuer("https://malicious.example/saml2")).toBe(false);
      expect([...runtime.getSamlAllowedIssuerOrigins()].sort()).toEqual([
        "https://accounts.google.com",
        "https://login.microsoft.com",
      ]);
    });

    it("rejects unparseable issuer URLs", async () => {
      const runtime = await loadFreshRuntime({
        ATLAS_PUBLIC_URL: "https://atlas.test",
        ATLAS_AUTH_INTERNAL_SECRET: "internal",
        ATLAS_SAML_ALLOWED_ISSUERS: "https://accounts.google.com",
      });

      expect(runtime.isAllowedSamlIssuer("not-a-url")).toBe(false);
    });
  });

  describe("getCimdResolverOptions", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("merges the configured allowlist into the default resolver options", async () => {
      const runtime = await loadFreshRuntime({
        ATLAS_PUBLIC_URL: "https://atlas.test",
        ATLAS_AUTH_INTERNAL_SECRET: "internal",
        ATLAS_OAUTH_CIMD_DOMAIN_ALLOWLIST: "atlas-clients.example, partner.example.com",
      });

      const options = runtime.getCimdResolverOptions();

      expect(options.allowedHostSuffixes).toEqual(["atlas-clients.example", "partner.example.com"]);
    });
  });
});
