import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atlasFetch } from "@/lib/orval/fetcher";

describe("atlasFetch", () => {
  const originalWindow = globalThis.window;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: vi.fn().mockResolvedValue({ ok: true }),
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    } as unknown as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
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

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/issue-areas?limit=100",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
        },
      }),
    );
  });

  it("resolves generated api paths against the configured public origin during server rendering", async () => {
    Reflect.deleteProperty(globalThis, "window");
    vi.stubEnv("ATLAS_PUBLIC_URL", "https://atlas.example.com");

    await atlasFetch("/api/issue-areas?limit=100");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://atlas.example.com/api/issue-areas?limit=100",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
        },
      }),
    );
  });
});
