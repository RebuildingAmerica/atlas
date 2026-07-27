import { describe, expect, it } from "vitest";
import {
  buildHostedRewriteDestination,
  buildMcpResourceUrl,
  isHostedAtlasEnv,
  normalizeApiProxyOrigin,
  normalizeDocsOrigin,
  validateHostedAtlasEnv,
} from "@/platform/config/hosted-env";

describe("hosted Atlas environment validation", () => {
  it("treats a build with no public origin as not hosted", () => {
    // Hostedness is derived from the public URL rather than a declared mode, so
    // a build that names no origin is a workstation build. A real deployment
    // that omits the URL still fails, at startup, in resolveAuthRuntimeConfig.
    expect(() => {
      validateHostedAtlasEnv({});
    }).not.toThrow();
  });

  it("validates any build that serves a real origin, whoever operates it", () => {
    // The previous mode-based check only fired for deploys that knew to name
    // themselves, so a self-hosted instance never got these checks at all.
    expect(() => {
      validateHostedAtlasEnv({
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
        ATLAS_AUTH_JWT_AUDIENCES: buildMcpResourceUrl("https://atlas.example.com"),
      });
    }).toThrow("ATLAS_SERVER_API_PROXY_TARGET is required for hosted Atlas deployments.");
  });

  it("requires hosted origins to use HTTPS", () => {
    expect(() => {
      validateHostedAtlasEnv({
        ATLAS_PUBLIC_URL: "http://atlas.example.com",
        ATLAS_SERVER_API_PROXY_TARGET: "https://api.atlas.example.com",
        ATLAS_AUTH_JWT_AUDIENCES: buildMcpResourceUrl("http://atlas.example.com"),
      });
    }).toThrow("ATLAS_PUBLIC_URL must use https in hosted Atlas deployments.");

    expect(() => {
      validateHostedAtlasEnv({
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
        ATLAS_SERVER_API_PROXY_TARGET: "http://api.atlas.example.com",
        ATLAS_AUTH_JWT_AUDIENCES: buildMcpResourceUrl("https://atlas.example.com"),
      });
    }).toThrow("ATLAS_SERVER_API_PROXY_TARGET must use https in hosted Atlas deployments.");
  });

  it("allows loopback HTTP origins for hosted-shaped end-to-end runs", () => {
    expect(() => {
      validateHostedAtlasEnv({
        ATLAS_PUBLIC_URL: "http://localhost:3100",
        ATLAS_SERVER_API_PROXY_TARGET: "http://127.0.0.1:38000",
        ATLAS_AUTH_JWT_AUDIENCES: buildMcpResourceUrl("http://localhost:3100"),
      });
    }).not.toThrow();
  });

  it("requires the canonical MCP audience first", () => {
    expect(() => {
      validateHostedAtlasEnv({
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
        ATLAS_SERVER_API_PROXY_TARGET: "https://api.atlas.example.com",
        ATLAS_AUTH_JWT_AUDIENCES: [
          "https://api.atlas.example.com",
          buildMcpResourceUrl("https://atlas.example.com"),
        ].join(","),
      });
    }).toThrow(
      "ATLAS_AUTH_JWT_AUDIENCES must put the canonical MCP resource first: https://atlas.example.com/mcp",
    );
  });

  it("accepts a complete production deploy environment", () => {
    expect(() => {
      validateHostedAtlasEnv({
        ATLAS_PUBLIC_URL: "https://atlas.example.com",
        ATLAS_SERVER_API_PROXY_TARGET: "https://api.atlas.example.com",
        ATLAS_AUTH_JWT_AUDIENCES: [
          buildMcpResourceUrl("https://atlas.example.com"),
          "https://api.atlas.example.com",
        ].join(","),
      });
    }).not.toThrow();
  });
});

describe("hosted Atlas URL helpers", () => {
  it("normalizes docs and API proxy origins through URL parsing", () => {
    expect(normalizeDocsOrigin("atlas-docs.example.com/docs")).toBe(
      "https://atlas-docs.example.com",
    );
    expect(normalizeDocsOrigin("")).toBeUndefined();
    expect(
      normalizeApiProxyOrigin({ ATLAS_SERVER_API_PROXY_TARGET: "atlas-api.example.com" }),
    ).toBe("https://atlas-api.example.com");
    expect(
      normalizeApiProxyOrigin({ ATLAS_SERVER_API_PROXY_TARGET: "http://127.0.0.1:8000" }),
    ).toBe("http://127.0.0.1:8000");
  });

  it("rejects non-local HTTP API proxy origins", () => {
    expect(() => {
      normalizeApiProxyOrigin({ ATLAS_SERVER_API_PROXY_TARGET: "http://atlas-api.example.com" });
    }).toThrow("ATLAS_SERVER_API_PROXY_TARGET must use https outside local development.");
  });

  it("builds Vercel rewrite destinations through URL parsing", () => {
    expect(buildHostedRewriteDestination("https://atlas-api.example.com", "/mcp/")).toBe(
      "https://atlas-api.example.com/mcp/",
    );
    expect(
      buildHostedRewriteDestination("https://atlas-docs.example.com/docs", "/docs/:match*"),
    ).toBe("https://atlas-docs.example.com/docs/:match*");
  });
});

describe("hosted Atlas environment detection", () => {
  it("treats production and staging deploys, and Vercel production, as hosted", () => {
    expect(isHostedAtlasEnv({ ATLAS_DEPLOY_MODE: "production" })).toBe(true);
    expect(isHostedAtlasEnv({ ATLAS_DEPLOY_MODE: "staging" })).toBe(true);
    expect(isHostedAtlasEnv({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("treats a local or preview environment as not hosted", () => {
    expect(isHostedAtlasEnv({})).toBe(false);
    expect(isHostedAtlasEnv({ ATLAS_DEPLOY_MODE: "development", VERCEL_ENV: "preview" })).toBe(
      false,
    );
  });

  it("skips validation entirely outside hosted deployments", () => {
    expect(() => {
      validateHostedAtlasEnv({ ATLAS_DEPLOY_MODE: "development" });
    }).not.toThrow();
  });
});

describe("hosted Atlas API proxy origin", () => {
  it("leaves the API proxy unset for local development", () => {
    expect(normalizeApiProxyOrigin({})).toBeUndefined();
    expect(normalizeApiProxyOrigin({ ATLAS_SERVER_API_PROXY_TARGET: "   " })).toBeUndefined();
  });

  it("insists a hosted deployment names its API proxy", () => {
    expect(() => {
      normalizeApiProxyOrigin({ ATLAS_DEPLOY_MODE: "staging" });
    }).toThrow("ATLAS_SERVER_API_PROXY_TARGET is required for hosted Atlas deployments.");
  });

  it("rejects a value that cannot be read as a URL", () => {
    expect(() => {
      normalizeApiProxyOrigin({ ATLAS_SERVER_API_PROXY_TARGET: "https://" });
    }).toThrow("ATLAS_SERVER_API_PROXY_TARGET must be an absolute URL.");
  });
});
