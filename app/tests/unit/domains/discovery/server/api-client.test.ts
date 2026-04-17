import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createInternalAuthHeaders: vi.fn(),
  getServerApiBaseUrl: vi.fn(),
  requireReadyAtlasSessionState: vi.fn(),
}));

vi.mock("@/domains/access/config", () => ({
  createInternalAuthHeaders: mocks.createInternalAuthHeaders,
}));

vi.mock("@/domains/access/server/session-state", () => ({
  requireReadyAtlasSessionState: mocks.requireReadyAtlasSessionState,
}));

vi.mock("@/platform/config/app-config", () => ({
  getServerApiBaseUrl: mocks.getServerApiBaseUrl,
}));

describe("requestAtlasApi", () => {
  const originalFetch = global.fetch;
  const originalInternalSecret = process.env.ATLAS_AUTH_INTERNAL_SECRET;

  beforeEach(() => {
    vi.resetModules();
    mocks.createInternalAuthHeaders.mockReset();
    mocks.getServerApiBaseUrl.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.getServerApiBaseUrl.mockReturnValue("https://atlas.test/api");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalInternalSecret === undefined) {
      delete process.env.ATLAS_AUTH_INTERNAL_SECRET;
    } else {
      process.env.ATLAS_AUTH_INTERNAL_SECRET = originalInternalSecret;
    }
    vi.unstubAllGlobals();
  });

  it("calls the Atlas API without internal headers for local sessions", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ ok: true }),
      ok: true,
      status: 200,
    } as unknown as Response);
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      isLocal: true,
      user: { email: "local@atlas.test", id: "local-operator" },
    });
    delete process.env.ATLAS_AUTH_INTERNAL_SECRET;

    const { requestAtlasApi } = await import("@/domains/discovery/server/api-client");
    await expect(requestAtlasApi("/discovery-runs")).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith("https://atlas.test/api/discovery-runs", {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    expect(mocks.createInternalAuthHeaders).not.toHaveBeenCalled();
  });

  it("adds internal auth headers for remote sessions and merges request init", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ ok: true }),
      ok: true,
      status: 200,
    } as unknown as Response);
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      isLocal: false,
      user: { email: "operator@atlas.test", id: "user_123" },
    });
    mocks.createInternalAuthHeaders.mockReturnValue({
      "x-atlas-internal-secret": "secret",
      "x-authenticated-user-email": "operator@atlas.test",
    });
    process.env.ATLAS_AUTH_INTERNAL_SECRET = "secret";

    const { requestAtlasApi } = await import("@/domains/discovery/server/api-client");
    await requestAtlasApi("/discovery-runs", {
      headers: {
        "x-extra": "1",
      },
      method: "POST",
    });

    expect(mocks.createInternalAuthHeaders).toHaveBeenCalledWith(
      { email: "operator@atlas.test", id: "user_123" },
      "secret",
    );
    expect(fetchMock).toHaveBeenCalledWith("https://atlas.test/api/discovery-runs", {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-atlas-internal-secret": "secret",
        "x-authenticated-user-email": "operator@atlas.test",
        "x-extra": "1",
      },
      method: "POST",
    });
  });

  it("throws when the Atlas API responds with an error", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue({
      json: vi.fn(),
      ok: false,
      status: 502,
    } as unknown as Response);
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      isLocal: true,
      user: { email: "local@atlas.test", id: "local-operator" },
    });

    const { requestAtlasApi } = await import("@/domains/discovery/server/api-client");
    await expect(requestAtlasApi("/discovery-runs")).rejects.toThrow(
      "Atlas API request failed (502)",
    );
  });

  it("treats blank internal secrets as disabled for remote sessions", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ ok: true }),
      ok: true,
      status: 200,
    } as unknown as Response);
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      isLocal: false,
      user: { email: "operator@atlas.test", id: "user_123" },
    });
    process.env.ATLAS_AUTH_INTERNAL_SECRET = "   ";

    const { requestAtlasApi } = await import("@/domains/discovery/server/api-client");
    await expect(requestAtlasApi("/discovery-runs")).resolves.toEqual({ ok: true });

    expect(mocks.createInternalAuthHeaders).not.toHaveBeenCalled();
  });
});
