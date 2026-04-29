import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";

const mocks = vi.hoisted(() => ({
  requireReadyAtlasSessionState: vi.fn(),
  getServerApiBaseUrl: vi.fn(),
}));

vi.mock("@/domains/access/server/session-state", () => ({
  requireReadyAtlasSessionState: mocks.requireReadyAtlasSessionState,
}));

vi.mock("@/platform/config/app-config", () => ({
  getServerApiBaseUrl: mocks.getServerApiBaseUrl,
}));

describe("api-client", () => {
  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  beforeEach(() => {
    vi.resetModules();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.getServerApiBaseUrl.mockReset();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn());

    vi.stubEnv("ATLAS_DEPLOY_MODE", "");
    vi.stubEnv("ATLAS_AUTH_INTERNAL_SECRET", "test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends an authenticated request to the Atlas API", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      user: { email: "operator@atlas.test", id: "user_123" },
      workspace: { activeOrganization: { id: "org_123" } },
    });
    mocks.getServerApiBaseUrl.mockReturnValue("https://api.atlas.test");
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: "test" }),
    } as Response);

    const result = await requestAtlasApi("/test-endpoint");

    expect(result).toEqual({ data: "test" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.atlas.test/test-endpoint",
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining returns any
        headers: expect.objectContaining({
          "X-Atlas-Actor-Email": "operator@atlas.test",
          "X-Atlas-Actor-Id": "user_123",
          "X-Atlas-Internal-Secret": "test-secret",
        }),
      }),
    );
  });

  it("throws when internal secret is missing outside local mode", async () => {
    vi.stubEnv("ATLAS_AUTH_INTERNAL_SECRET", "");
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      user: { email: "operator@atlas.test", id: "user_123" },
      workspace: { activeOrganization: { id: "org_123" } },
    });
    await expect(requestAtlasApi("/test-endpoint")).rejects.toThrow(
      "ATLAS_AUTH_INTERNAL_SECRET is required for authenticated discovery requests.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends an unauthenticated request in local mode", async () => {
    vi.stubEnv("ATLAS_DEPLOY_MODE", "local");
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      user: { email: "local@atlas.local", id: "local-user" },
    });
    mocks.getServerApiBaseUrl.mockReturnValue("https://api.atlas.test");
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: "test" }),
    } as Response);

    await requestAtlasApi("/test-endpoint");

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("throws when the API response is not ok", async () => {
    vi.stubEnv("ATLAS_DEPLOY_MODE", "local");
    mocks.requireReadyAtlasSessionState.mockResolvedValue({});
    mocks.getServerApiBaseUrl.mockReturnValue("https://api.atlas.test");
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    await expect(requestAtlasApi("/not-found")).rejects.toThrow("Atlas API request failed (404)");
  });
});
