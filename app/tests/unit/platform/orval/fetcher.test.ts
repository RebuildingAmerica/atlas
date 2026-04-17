import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atlasFetch } from "@/lib/orval/fetcher";

describe("atlasFetch", () => {
  const originalFetch = global.fetch;
  const originalWindow = globalThis.window;
  const originalPublicUrl = process.env.ATLAS_PUBLIC_URL;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ ok: true }),
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;

    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }

    if (originalPublicUrl === undefined) {
      delete process.env.ATLAS_PUBLIC_URL;
    } else {
      process.env.ATLAS_PUBLIC_URL = originalPublicUrl;
    }
  });

  it("resolves generated api paths against the current browser origin", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          origin: "http://127.0.0.1:3100",
        },
      },
    });

    await atlasFetch("/api/issue-areas?limit=100");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/issue-areas?limit=100",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
        },
      }),
    );
  });

  it("resolves generated api paths against the configured public origin during server rendering", async () => {
    delete (globalThis as { window?: Window }).window;
    process.env.ATLAS_PUBLIC_URL = "https://atlas.example.com";

    await atlasFetch("/api/issue-areas?limit=100");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://atlas.example.com/api/issue-areas?limit=100",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
        },
      }),
    );
  });
});
