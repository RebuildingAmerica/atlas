import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { baseRuntimeConfig } from "./support";

const mocks = vi.hoisted(() => ({
  createInternalAuthHeaders: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  loadAtlasSession: vi.fn(),
}));

vi.mock("@/domains/access/config", () => ({
  createInternalAuthHeaders: mocks.createInternalAuthHeaders,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/session-state", () => ({
  loadAtlasSession: mocks.loadAtlasSession,
}));

describe("proxyAtlasApiRequest config", () => {
  beforeEach(() => {
    mocks.createInternalAuthHeaders.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.loadAtlasSession.mockReset();
    vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn());
    mocks.getAuthRuntimeConfig.mockReturnValue(baseRuntimeConfig());
    mocks.loadAtlasSession.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 502 when the proxy target is missing", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      ...baseRuntimeConfig(),
      apiBaseUrl: null,
    });

    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    const response = await proxyAtlasApiRequest(new Request("https://atlas.test/api/entities"));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error:
        "Atlas API proxy target is not configured. Set ATLAS_SERVER_API_PROXY_TARGET on the app server or configure public /api routing to the Atlas API.",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 503 when the upstream API is unavailable", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockRejectedValue(new Error("network down"));

    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    const response = await proxyAtlasApiRequest(new Request("https://atlas.test/api/entities"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Atlas API is unavailable.",
    });
    expect(mocks.loadAtlasSession).not.toHaveBeenCalled();
  });
});
