import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("vercel config", () => {
  const originalDocsUrl = process.env.ATLAS_DOCS_URL;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.ATLAS_DOCS_URL;
  });

  afterEach(() => {
    vi.resetModules();

    if (originalDocsUrl === undefined) {
      delete process.env.ATLAS_DOCS_URL;
    } else {
      process.env.ATLAS_DOCS_URL = originalDocsUrl;
    }
  });

  it("adds docs rewrites when a Mintlify origin is configured", async () => {
    process.env.ATLAS_DOCS_URL = "https://atlas-docs.example.com";

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
