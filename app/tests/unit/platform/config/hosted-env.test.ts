import { describe, expect, it } from "vitest";
import {
  buildHostedRewriteDestination,
  buildMcpResourceUrl,
  normalizeApiProxyOrigin,
  normalizeDocsOrigin,
  validateHostedAtlasEnv,
} from "@/platform/config/hosted-env";

describe("hosted Atlas environment validation", () => {
  it("requires a real map style URL for hosted deployments", () => {
    expect(() => {
      validateHostedAtlasEnv(
        {
          ATLAS_DEPLOY_MODE: "production",
          ATLAS_PUBLIC_URL: "https://atlas.example.com",
          ATLAS_SERVER_API_PROXY_TARGET: "https://api.atlas.example.com",
          ATLAS_API_AUDIENCE: buildMcpResourceUrl("https://atlas.example.com"),
        },
        { requireMapStyle: true },
      );
    }).toThrow("ATLAS_MAP_STYLE_URL is required for hosted Atlas deployments.");

    expect(() => {
      validateHostedAtlasEnv(
        {
          ATLAS_MAP_STYLE_URL: "https://maptiler.invalid/maps/atlas-placeholder/style.json",
          ATLAS_PUBLIC_URL: "https://atlas.example.com",
          ATLAS_SERVER_API_PROXY_TARGET: "https://api.atlas.example.com",
          ATLAS_API_AUDIENCE: buildMcpResourceUrl("https://atlas.example.com"),
          VERCEL_ENV: "production",
        },
        { requireMapStyle: true },
      );
    }).toThrow("ATLAS_MAP_STYLE_URL must not use the placeholder in hosted Atlas deployments.");
  });

  it("requires hosted public and API routing values", () => {
    expect(() => {
      validateHostedAtlasEnv(
        {
          ATLAS_DEPLOY_MODE: "production",
          ATLAS_MAP_STYLE_URL: "https://api.maptiler.com/maps/atlas/style.json",
        },
        { requireMapStyle: true },
      );
    }).toThrow("ATLAS_PUBLIC_URL is required for hosted Atlas deployments.");

    expect(() => {
      validateHostedAtlasEnv(
        {
          ATLAS_DEPLOY_MODE: "production",
          ATLAS_MAP_STYLE_URL: "https://api.maptiler.com/maps/atlas/style.json",
          ATLAS_PUBLIC_URL: "https://atlas.example.com",
          ATLAS_API_AUDIENCE: buildMcpResourceUrl("https://atlas.example.com"),
        },
        { requireMapStyle: true },
      );
    }).toThrow("ATLAS_SERVER_API_PROXY_TARGET is required for hosted Atlas deployments.");
  });

  it("requires hosted origins to use HTTPS", () => {
    expect(() => {
      validateHostedAtlasEnv(
        {
          ATLAS_DEPLOY_MODE: "production",
          ATLAS_MAP_STYLE_URL: "https://api.maptiler.com/maps/atlas/style.json",
          ATLAS_PUBLIC_URL: "http://atlas.example.com",
          ATLAS_SERVER_API_PROXY_TARGET: "https://api.atlas.example.com",
          ATLAS_API_AUDIENCE: buildMcpResourceUrl("http://atlas.example.com"),
        },
        { requireMapStyle: true },
      );
    }).toThrow("ATLAS_PUBLIC_URL must use https in hosted Atlas deployments.");

    expect(() => {
      validateHostedAtlasEnv(
        {
          ATLAS_DEPLOY_MODE: "production",
          ATLAS_MAP_STYLE_URL: "https://api.maptiler.com/maps/atlas/style.json",
          ATLAS_PUBLIC_URL: "https://atlas.example.com",
          ATLAS_SERVER_API_PROXY_TARGET: "http://api.atlas.example.com",
          ATLAS_API_AUDIENCE: buildMcpResourceUrl("https://atlas.example.com"),
        },
        { requireMapStyle: true },
      );
    }).toThrow("ATLAS_SERVER_API_PROXY_TARGET must use https in hosted Atlas deployments.");
  });

  it("allows loopback HTTP origins for hosted-shaped end-to-end runs", () => {
    expect(() => {
      validateHostedAtlasEnv(
        {
          ATLAS_DEPLOY_MODE: "production",
          ATLAS_MAP_STYLE_URL: "https://api.maptiler.com/maps/atlas/style.json",
          ATLAS_PUBLIC_URL: "http://localhost:3100",
          ATLAS_SERVER_API_PROXY_TARGET: "http://127.0.0.1:38000",
          ATLAS_API_AUDIENCE: buildMcpResourceUrl("http://localhost:3100"),
        },
        { requireMapStyle: true },
      );
    }).not.toThrow();
  });

  it("requires the canonical MCP audience first", () => {
    expect(() => {
      validateHostedAtlasEnv(
        {
          ATLAS_DEPLOY_MODE: "production",
          ATLAS_MAP_STYLE_URL: "https://api.maptiler.com/maps/atlas/style.json",
          ATLAS_PUBLIC_URL: "https://atlas.example.com",
          ATLAS_SERVER_API_PROXY_TARGET: "https://api.atlas.example.com",
          ATLAS_API_AUDIENCE: [
            "https://api.atlas.example.com",
            buildMcpResourceUrl("https://atlas.example.com"),
          ].join(","),
        },
        { requireMapStyle: true },
      );
    }).toThrow(
      "ATLAS_API_AUDIENCE must put the canonical MCP resource first: https://atlas.example.com/mcp",
    );
  });

  it("accepts a complete production deploy environment", () => {
    expect(() => {
      validateHostedAtlasEnv(
        {
          ATLAS_DEPLOY_MODE: "production",
          ATLAS_MAP_STYLE_URL: "https://api.maptiler.com/maps/atlas/style.json",
          ATLAS_PUBLIC_URL: "https://atlas.example.com",
          ATLAS_SERVER_API_PROXY_TARGET: "https://api.atlas.example.com",
          ATLAS_API_AUDIENCE: [
            buildMcpResourceUrl("https://atlas.example.com"),
            "https://api.atlas.example.com",
          ].join(","),
        },
        { requireMapStyle: true },
      );
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
