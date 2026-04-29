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
});
