import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atlasFetch } from "@/lib/orval/fetcher";

describe("atlasFetch additional branches", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("ATLAS_PUBLIC_URL", "https://atlas.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("preserves absolute request urls and adds json content headers for request bodies", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ ok: true }),
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    } as unknown as Response);

    await atlasFetch("https://api.atlas.test/entities", {
      body: JSON.stringify({ ok: true }),
      method: "POST",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.atlas.test/entities",
      expect.objectContaining({
        body: JSON.stringify({ ok: true }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
  });

  it("maps 5xx Atlas API responses to a friendly fallback message", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue({
      json: vi.fn(),
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue("Internal Server Error"),
    } as unknown as Response);

    await expect(atlasFetch("/api/entities")).rejects.toThrow(
      "Atlas is temporarily unavailable. Please try again.",
    );
  });

  it("falls back to a status-based error message and handles 204 responses", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce({
        json: vi.fn(),
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue(""),
      } as unknown as Response)
      .mockResolvedValueOnce({
        json: vi.fn(),
        ok: true,
        status: 204,
        text: vi.fn().mockResolvedValue(""),
      } as unknown as Response);

    await expect(atlasFetch("/api/entities")).rejects.toThrow("Atlas API request failed (404)");
    await expect(atlasFetch("/api/entities")).resolves.toBeUndefined();
  });
});
