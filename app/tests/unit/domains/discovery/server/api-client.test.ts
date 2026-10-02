import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { requestAtlasApi, requestAtlasService } from "@/domains/discovery/server/api-client";

const mocks = vi.hoisted(() => ({
  requireReadyAtlasSessionState: vi.fn(),
  getServerApiBaseUrl: vi.fn(),
  getServerServiceBaseUrl: vi.fn(),
}));

vi.mock("@/domains/access/server/session-state", () => ({
  requireReadyAtlasSessionState: mocks.requireReadyAtlasSessionState,
}));

vi.mock("@/domains/access/server/app-actor-assertion", () => ({
  createAppActorHeaders: (
    actor: { id: string },
    options: { accountReady: boolean; organizationId?: string },
  ) =>
    Promise.resolve({
      "X-Atlas-Actor-Assertion": `assertion-for-${actor.id}-in-${options.organizationId ?? "none"}-ready-${String(options.accountReady)}`,
    }),
}));

vi.mock("@/platform/config/app-config", () => ({
  getServerApiBaseUrl: mocks.getServerApiBaseUrl,
  getServerServiceBaseUrl: mocks.getServerServiceBaseUrl,
}));

describe("api-client", () => {
  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  beforeEach(() => {
    vi.resetModules();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.getServerApiBaseUrl.mockReset();
    mocks.getServerServiceBaseUrl.mockReset();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn());

    vi.stubEnv("ATLAS_MULTI_USER", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends an authenticated request to the Atlas API", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      accountReady: true,
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
          "X-Atlas-Actor-Assertion": "assertion-for-user_123-in-org_123-ready-true",
        }),
      }),
    );
  });

  it("sends service-level requests to the service origin without an API prefix", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      accountReady: true,
      user: { email: "operator@atlas.test", id: "user_123" },
      workspace: { activeOrganization: { id: "org_123" } },
    });
    mocks.getServerServiceBaseUrl.mockReturnValue("https://api.atlas.test");
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    } as Response);

    const result = await requestAtlasService("/health");

    expect(result).toEqual({ status: "ok" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.atlas.test/health",
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining returns any
        headers: expect.objectContaining({
          "X-Atlas-Actor-Assertion": "assertion-for-user_123-in-org_123-ready-true",
        }),
      }),
    );
  });

  it("sends an unauthenticated request in local mode", async () => {
    vi.stubEnv("ATLAS_MULTI_USER", "false");
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

  it("throws a classifiable generic error for an unexpected non-ok status", async () => {
    vi.stubEnv("ATLAS_MULTI_USER", "false");
    mocks.requireReadyAtlasSessionState.mockResolvedValue({});
    mocks.getServerApiBaseUrl.mockReturnValue("https://api.atlas.test");
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    await expect(requestAtlasApi("/not-found")).rejects.toMatchObject({
      name: "AtlasApiError",
      code: "ATLAS_API_REQUEST_FAILED",
      message: "ATLAS_API_REQUEST_FAILED",
    });
  });

  it("throws an at-limit error when the API responds 429", async () => {
    vi.stubEnv("ATLAS_MULTI_USER", "false");
    mocks.requireReadyAtlasSessionState.mockResolvedValue({});
    mocks.getServerApiBaseUrl.mockReturnValue("https://api.atlas.test");
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
    } as Response);

    await expect(requestAtlasApi("/discovery-runs")).rejects.toMatchObject({
      code: "ATLAS_API_AT_LIMIT",
    });
  });

  it("throws a temporarily-unavailable error when the API responds 5xx", async () => {
    vi.stubEnv("ATLAS_MULTI_USER", "false");
    mocks.requireReadyAtlasSessionState.mockResolvedValue({});
    mocks.getServerApiBaseUrl.mockReturnValue("https://api.atlas.test");
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    await expect(requestAtlasApi("/discovery-runs")).rejects.toMatchObject({
      code: "ATLAS_API_TEMPORARILY_UNAVAILABLE",
    });
  });
});
