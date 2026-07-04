import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("vercel config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ATLAS_DOCS_URL", "");
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("adds docs rewrites when a Mintlify origin is configured", async () => {
    vi.stubEnv("ATLAS_DOCS_URL", "https://atlas-docs.example.com");

    const { config } = await import("../../vercel");

    expect(config.rewrites).toEqual(
      expect.arrayContaining([
        {
          source: "/docs",
          destination: "https://atlas-docs.example.com/docs",
        },
        {
          source: "/docs/:match*",
          destination: "https://atlas-docs.example.com/docs/:match*",
        },
      ]),
    );
  });

  it("allows app fonts, map tiles, and map workers in the deployed CSP", async () => {
    const { config } = await import("../../vercel");
    const appHeaders = config.headers.find((entry) => entry.source === "/(.*)");
    const csp = appHeaders?.headers.find((header) => header.key === "Content-Security-Policy");

    expect(csp?.value).toContain("connect-src 'self'");
    expect(csp?.value).toContain("https://*.maptiler.com");
    expect(csp?.value).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp?.value).toContain("font-src 'self' data: https://fonts.gstatic.com");
    expect(csp?.value).toContain("worker-src 'self' blob:");
  });
});
