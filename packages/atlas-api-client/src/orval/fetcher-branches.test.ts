import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_API_ERROR_MESSAGES,
  AtlasApiError,
  atlasApiErrorMessage,
  atlasFetch,
} from "./fetcher";

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

  it("keeps a rate limiter's body out of the message and on the error for logs", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue({
      json: vi.fn(),
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue('{"detail":"Too many requests."}'),
    } as unknown as Response);

    const error: unknown = await atlasFetch("/api/entities").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AtlasApiError);
    expect(error).toMatchObject({
      body: '{"detail":"Too many requests."}',
      message: "Atlas is busy right now. Try again in a moment.",
      name: "AtlasApiError",
      status: 429,
    });
  });

  it("chooses the message by status class and never from the body", () => {
    const cases: [number, string][] = [
      [400, ATLAS_API_ERROR_MESSAGES.invalid],
      [422, ATLAS_API_ERROR_MESSAGES.invalid],
      [401, ATLAS_API_ERROR_MESSAGES.signIn],
      [403, ATLAS_API_ERROR_MESSAGES.forbidden],
      [404, ATLAS_API_ERROR_MESSAGES.notFound],
      [410, ATLAS_API_ERROR_MESSAGES.notFound],
      [409, ATLAS_API_ERROR_MESSAGES.conflict],
      [408, ATLAS_API_ERROR_MESSAGES.busy],
      [425, ATLAS_API_ERROR_MESSAGES.busy],
      [429, ATLAS_API_ERROR_MESSAGES.busy],
      [500, ATLAS_API_ERROR_MESSAGES.unavailable],
      [503, ATLAS_API_ERROR_MESSAGES.unavailable],
      [418, ATLAS_API_ERROR_MESSAGES.failed],
    ];

    for (const [status, message] of cases) {
      expect(atlasApiErrorMessage(status)).toBe(message);
      expect(new AtlasApiError(status, "<html>Traceback</html>").message).toBe(message);
    }
  });

  it("uses the not-found sentence for an empty 404 body and handles 204 responses", async () => {
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

    await expect(atlasFetch("/api/entities")).rejects.toThrow(ATLAS_API_ERROR_MESSAGES.notFound);
    await expect(atlasFetch("/api/entities")).resolves.toBeUndefined();
  });
});
