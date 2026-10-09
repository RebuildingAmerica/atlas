import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isInstanceOperatorEmail,
  resolveAuthRuntimeConfig,
  RETIRED_OPERATOR_ALLOWLIST_MESSAGE,
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
        ATLAS_AUTH_INTERNAL_SECRET: "internal-test-secret", // pragma: allowlist secret
        ATLAS_AUTH_CALLBACK_SECRET: "callback-test-secret", // pragma: allowlist secret
        ATLAS_EDGE_ORIGIN_SECRET: "edge-test-secret", // pragma: allowlist secret
        ATLAS_EMAIL_RESEND_API_KEY: "re_test_123", // pragma: allowlist secret
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
      },
      "/workspace/atlas/app",
    );

    expect(runtime.emailProvider).toBe("resend");
  });

  it("rejects a configured introspection URL that is not absolute", () => {
    expect(() =>
      resolveAuthRuntimeConfig(
        {
          ATLAS_AUTH_API_KEY_INTROSPECTION_URL: "not a url", // pragma: allowlist secret
          ATLAS_PUBLIC_URL: "https://atlas.example.com",
        },
        "/workspace",
      ),
    ).toThrow("ATLAS_AUTH_API_KEY_INTROSPECTION_URL must be an absolute URL.");
  });

  it("rejects a configured API proxy target that is not absolute", () => {
    expect(() =>
      resolveAuthRuntimeConfig(
        {
          ATLAS_PUBLIC_URL: "https://atlas.example.com",
          ATLAS_SERVER_API_PROXY_TARGET: "also not a url",
        },
        "/workspace",
      ),
    ).toThrow("ATLAS_SERVER_API_PROXY_TARGET must be an absolute URL.");
  });

  it("does not require enabled-mode settings when auth is disabled", () => {
    expect(() => {
      validateAuthRuntimeConfig({
        adminPublicUrl: null,
        authJwtAudience: null,
        authJwtAudiences: [],
        apiBaseUrl: null,
        atprotoPdsAdminPassword: null,
        atprotoPdsInviteBrokerSecret: null,
        atprotoPdsInviteBrokerUrl: null,
        atprotoPdsUrl: null,
        instanceOperatorEmails: new Set(),
        platformOperatorEmails: new Set(),
        anonymousRateLimit: {
          enabled: true,
          readsPerMinute: 30,
          totalPerHour: 120,
          trustedProxyHops: 1,
          writesPerMinute: 10,
        },
        apiKeyIntrospectionUrl: null,
        databaseUrl: null,
        localMode: true,
        openRegistration: true,
        captureUrl: null,
        dbPath: "/tmp/atlas-auth.sqlite",
        emailFrom: "Atlas <auth@atlas.test>",
        emailProvider: "capture",
        internalSecret: "internal-test-secret", // pragma: allowlist secret
        callbackSecret: "",
        edgeOriginSecret: "",
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

  describe("when no instance operator is listed", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("blocks bootstrap access", () => {
      vi.stubEnv("ATLAS_PUBLIC_URL", "https://atlas.test");
      vi.stubEnv("ATLAS_INSTANCE_OPERATOR_EMAILS", "");

      expect(isInstanceOperatorEmail("anyone@atlas.test")).toBe(false);
    });
  });

  describe("the retired single allowlist", () => {
    it("stops the app and names the settings that replace it", () => {
      expect(() =>
        resolveAuthRuntimeConfig(
          {
            ATLAS_OPERATOR_ALLOWED_EMAILS: "editor@atlas.test",
            ATLAS_PUBLIC_URL: "https://atlas.test",
          },
          "/srv/atlas",
        ),
      ).toThrow(RETIRED_OPERATOR_ALLOWLIST_MESSAGE);
    });

    it("is ignored when set but empty", () => {
      const runtime = resolveAuthRuntimeConfig(
        {
          ATLAS_OPERATOR_ALLOWED_EMAILS: " ",
          ATLAS_PLATFORM_OPERATOR_EMAILS: "Platform@Atlas.test",
          ATLAS_PUBLIC_URL: "http://127.0.0.1:3100",
        },
        "/srv/atlas",
      );

      expect([...runtime.platformOperatorEmails]).toEqual(["platform@atlas.test"]);
      expect(runtime.instanceOperatorEmails.size).toBe(0);
    });
  });

  describe("instance operators with entries", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("admits the listed emails and rejects others", async () => {
      const runtime = await loadFreshRuntime({
        ATLAS_PUBLIC_URL: "https://atlas.test",
        ATLAS_AUTH_INTERNAL_SECRET: "internal", // pragma: allowlist secret
        ATLAS_AUTH_CALLBACK_SECRET: "callback-test-secret", // pragma: allowlist secret
        ATLAS_EDGE_ORIGIN_SECRET: "edge-test-secret", // pragma: allowlist secret
        ATLAS_INSTANCE_OPERATOR_EMAILS: "ops@atlas.test, ROOT@atlas.test",
      });

      expect(runtime.isInstanceOperatorEmail("ops@atlas.test")).toBe(true);
      expect(runtime.isInstanceOperatorEmail(" Root@Atlas.Test ")).toBe(true);
      expect(runtime.isInstanceOperatorEmail("intruder@atlas.test")).toBe(false);
    });
  });

  describe("SAML issuer allowlist", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("rejects every issuer when the allowlist is empty", async () => {
      const runtime = await loadFreshRuntime({
        ATLAS_PUBLIC_URL: "https://atlas.test",
        ATLAS_AUTH_INTERNAL_SECRET: "internal", // pragma: allowlist secret
        ATLAS_AUTH_CALLBACK_SECRET: "callback-test-secret", // pragma: allowlist secret
        ATLAS_EDGE_ORIGIN_SECRET: "edge-test-secret", // pragma: allowlist secret
        ATLAS_SAML_ALLOWED_ISSUERS: "",
      });

      expect(runtime.isAllowedSamlIssuer("https://idp.example.com/saml2")).toBe(false);
      expect(runtime.getSamlAllowedIssuerOrigins()).toEqual([]);
    });

    it("matches by URL origin and ignores query parameters", async () => {
      const runtime = await loadFreshRuntime({
        ATLAS_PUBLIC_URL: "https://atlas.test",
        ATLAS_AUTH_INTERNAL_SECRET: "internal", // pragma: allowlist secret
        ATLAS_AUTH_CALLBACK_SECRET: "callback-test-secret", // pragma: allowlist secret
        ATLAS_EDGE_ORIGIN_SECRET: "edge-test-secret", // pragma: allowlist secret
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
        ATLAS_AUTH_INTERNAL_SECRET: "internal", // pragma: allowlist secret
        ATLAS_AUTH_CALLBACK_SECRET: "callback-test-secret", // pragma: allowlist secret
        ATLAS_EDGE_ORIGIN_SECRET: "edge-test-secret", // pragma: allowlist secret
        ATLAS_SAML_ALLOWED_ISSUERS: "https://accounts.google.com",
      });

      expect(runtime.isAllowedSamlIssuer("not-a-url")).toBe(false);
    });

    it("rejects allowlist entries that are not parseable URLs at resolve time", () => {
      expect(() =>
        resolveAuthRuntimeConfig(
          {
            ATLAS_PUBLIC_URL: "https://atlas.test",
            ATLAS_SAML_ALLOWED_ISSUERS: "not-a-url",
          },
          "/workspace/atlas/app",
        ),
      ).toThrow(/ATLAS_SAML_ALLOWED_ISSUERS contains an invalid URL/);
    });
  });

  describe("resolveAdminPublicUrl", () => {
    it("is absent on a deployment with no platform admin", () => {
      expect(
        resolveAuthRuntimeConfig({ ATLAS_PUBLIC_URL: "https://atlas.test" }, "/workspace/atlas/app")
          .adminPublicUrl,
      ).toBeNull();
    });

    it("keeps only the admin's origin", () => {
      expect(
        resolveAuthRuntimeConfig(
          {
            ATLAS_ADMIN_PUBLIC_URL: "https://admin.atlas.test/discounts",
            ATLAS_PUBLIC_URL: "https://atlas.test",
          },
          "/workspace/atlas/app",
        ).adminPublicUrl,
      ).toBe("https://admin.atlas.test");
    });

    it("refuses a platform admin that is not on https", () => {
      expect(() =>
        resolveAuthRuntimeConfig(
          {
            ATLAS_ADMIN_PUBLIC_URL: "http://admin.atlas.test",
            ATLAS_PUBLIC_URL: "https://atlas.test",
          },
          "/workspace/atlas/app",
        ),
      ).toThrow("ATLAS_ADMIN_PUBLIC_URL must use https.");
    });
  });

  describe("resolveAtprotoPdsUrl", () => {
    it("refuses a PDS origin that identities could not safely be hosted on", () => {
      expect(() =>
        resolveAuthRuntimeConfig(
          { ATLAS_PDS_PUBLIC_URL: "http://pds.atlas.test", ATLAS_PUBLIC_URL: "https://atlas.test" },
          "/workspace/atlas/app",
        ),
      ).toThrow("ATLAS_PDS_PUBLIC_URL must use https.");

      for (const configured of [
        "https://admin:secret@pds.atlas.test",
        "https://pds.atlas.test/?tenant=1",
        "https://pds.atlas.test/#fragment",
      ]) {
        expect(() =>
          resolveAuthRuntimeConfig(
            { ATLAS_PDS_PUBLIC_URL: configured, ATLAS_PUBLIC_URL: "https://atlas.test" },
            "/workspace/atlas/app",
          ),
        ).toThrow("ATLAS_PDS_PUBLIC_URL must be a public origin without credentials or fragments.");
      }
    });
  });

  describe("getCimdResolverOptions", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("merges the configured allowlist into the default resolver options", async () => {
      const runtime = await loadFreshRuntime({
        ATLAS_PUBLIC_URL: "https://atlas.test",
        ATLAS_AUTH_INTERNAL_SECRET: "internal", // pragma: allowlist secret
        ATLAS_AUTH_CALLBACK_SECRET: "callback-test-secret", // pragma: allowlist secret
        ATLAS_EDGE_ORIGIN_SECRET: "edge-test-secret", // pragma: allowlist secret
        ATLAS_OAUTH_CIMD_DOMAIN_ALLOWLIST: "atlas-clients.example, partner.example.com",
      });

      const options = runtime.getCimdResolverOptions();

      expect(options.allowedHostSuffixes).toEqual(["atlas-clients.example", "partner.example.com"]);
    });
  });
});
