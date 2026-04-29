import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("proxyAtlasApiRequest", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createInternalAuthHeaders.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.loadAtlasSession.mockReset();
    vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn());
    mocks.getAuthRuntimeConfig.mockReturnValue({
      apiBaseUrl: "https://api.atlas.test",
      internalSecret: "internal-test-secret",
      localMode: false,
    });
    mocks.loadAtlasSession.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 502 when the API proxy target is not configured", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      apiBaseUrl: null,
      internalSecret: "internal-test-secret",
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

  it("forwards API requests to the configured backend and injects internal auth headers", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          connection: "keep-alive",
          "content-type": "application/json",
          "set-cookie": "api-cookie=value",
        },
        status: 201,
        statusText: "Created",
      }),
    );
    mocks.loadAtlasSession.mockResolvedValue({
      user: {
        email: "operator@atlas.test",
        id: "user-123",
      },
      workspace: {
        activeOrganization: {
          id: "org-456",
        },
      },
    });
    mocks.createInternalAuthHeaders.mockReturnValue({
      "X-Atlas-Actor-Email": "operator@atlas.test",
      "X-Atlas-Actor-Id": "user-123",
      "X-Atlas-Internal-Secret": "internal-test-secret",
      "X-Atlas-Organization-Id": "org-456",
    });

    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    const request = new Request("https://atlas.test/api/entities?state=CA", {
      body: JSON.stringify({ query: "housing" }),
      headers: {
        Accept: "application/json",
        Cookie: "session=secret",
        "Content-Type": "application/json",
        Host: "atlas.test",
      },
      method: "POST",
    });

    const response = await proxyAtlasApiRequest(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.atlas.test/api/entities?state=CA");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    expect(init?.body).toBeInstanceOf(ArrayBuffer);

    const forwardedHeaders = new Headers(init?.headers);
    expect(forwardedHeaders.get("accept")).toBe("application/json");
    expect(forwardedHeaders.get("content-type")).toBe("application/json");
    expect(forwardedHeaders.get("cookie")).toBeNull();
    expect(forwardedHeaders.get("host")).toBeNull();
    expect(forwardedHeaders.get("x-atlas-actor-email")).toBe("operator@atlas.test");
    expect(forwardedHeaders.get("x-atlas-actor-id")).toBe("user-123");
    expect(forwardedHeaders.get("x-atlas-internal-secret")).toBe("internal-test-secret");
    expect(forwardedHeaders.get("x-atlas-organization-id")).toBe("org-456");
    expect(mocks.createInternalAuthHeaders).toHaveBeenCalledWith(
      {
        email: "operator@atlas.test",
        id: "user-123",
      },
      "internal-test-secret",
      {
        organizationId: "org-456",
      },
    );

    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("connection")).toBeNull();
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

  it("skips session loading for anonymous requests without cookies", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      }),
    );

    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    const response = await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities?limit=1", {
        headers: {
          Accept: "application/json",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.loadAtlasSession).not.toHaveBeenCalled();
    expect(mocks.createInternalAuthHeaders).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.atlas.test/api/entities?limit=1",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
      }),
    );
  });
});
