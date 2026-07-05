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
      anonymousRateLimit: {
        enabled: true,
        readsPerMinute: 30,
        totalPerHour: 120,
        trustedProxyHops: 1,
        writesPerMinute: 10,
      },
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
      anonymousRateLimit: {
        enabled: true,
        readsPerMinute: 30,
        totalPerHour: 120,
        trustedProxyHops: 1,
        writesPerMinute: 10,
      },
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
        Forwarded: "for=203.0.113.10;host=spoofed.example",
        Host: "atlas.test",
        "X-Forwarded-For": "203.0.113.10",
        "X-Forwarded-Host": "spoofed.example",
        "X-Forwarded-Proto": "http",
        "X-Atlas-Client-IP": "192.0.2.99",
        "X-Atlas-Proxy-Secret": "spoofed-secret",
        "X-Real-IP": "203.0.113.10",
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
    expect(forwardedHeaders.get("forwarded")).toBeNull();
    expect(forwardedHeaders.get("host")).toBeNull();
    expect(forwardedHeaders.get("x-forwarded-for")).toBeNull();
    expect(forwardedHeaders.get("x-forwarded-host")).toBeNull();
    expect(forwardedHeaders.get("x-forwarded-proto")).toBeNull();
    expect(forwardedHeaders.get("x-real-ip")).toBeNull();
    expect(forwardedHeaders.get("x-atlas-client-ip")).toBe("203.0.113.10");
    expect(forwardedHeaders.get("x-atlas-proxy-secret")).toBe("internal-test-secret");
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

  it("forwards without internal auth headers when the cookie has no session", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    mocks.loadAtlasSession.mockResolvedValue(null);

    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    const response = await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities", {
        headers: {
          Cookie: "session=ghost",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.loadAtlasSession).toHaveBeenCalledTimes(1);
    expect(mocks.createInternalAuthHeaders).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const forwardedHeaders = new Headers(init?.headers);
    expect(forwardedHeaders.get("x-atlas-actor-id")).toBeNull();
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
          "X-Forwarded-For": "203.0.113.50",
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

  it("blocks anonymous proxy requests before they reach the API", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    mocks.getAuthRuntimeConfig.mockReturnValue({
      anonymousRateLimit: {
        enabled: true,
        readsPerMinute: 1,
        totalPerHour: 100,
        trustedProxyHops: 1,
        writesPerMinute: 1,
      },
      apiBaseUrl: "https://api.atlas.test",
      internalSecret: "internal-test-secret",
      localMode: false,
    });

    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    const first = await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities", {
        headers: { "X-Forwarded-For": "203.0.113.77" },
      }),
    );
    const blocked = await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities", {
        headers: { "X-Forwarded-For": "203.0.113.77" },
      }),
    );

    expect(first.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ detail: "Too many requests." });
    expect(blocked.headers.get("cache-control")).toBe("no-store");
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(blocked.headers.get("x-ratelimit-limit")).toBe("1");
    expect(Number(blocked.headers.get("x-ratelimit-reset"))).toBeGreaterThan(1_000_000_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs privacy-safe anonymous proxy blocks", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const warnCalls: unknown[][] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnCalls.push(args);
    });
    mocks.getAuthRuntimeConfig.mockReturnValue({
      anonymousRateLimit: {
        enabled: true,
        readsPerMinute: 1,
        totalPerHour: 100,
        trustedProxyHops: 1,
        writesPerMinute: 1,
      },
      apiBaseUrl: "https://api.atlas.test",
      internalSecret: "internal-test-secret",
      localMode: false,
    });

    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities", {
        headers: { "X-Forwarded-For": "203.0.113.77" },
      }),
    );
    const blocked = await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities", {
        headers: { "X-Forwarded-For": "203.0.113.77" },
      }),
    );

    expect(blocked.status).toBe(429);
    expect(warnSpy).toHaveBeenCalledWith(
      "anonymous_rate_limited",
      expect.objectContaining({
        bucket: "read-minute",
        event: "anonymous_rate_limited",
        layer: "app-proxy",
        method: "GET",
        path_group: "/api/*",
        retry_after_seconds: 60,
      }),
    );
    const payload = warnCalls[0]?.[1];
    expect(JSON.stringify(payload)).not.toContain("203.0.113.77");
  });

  it("does not let credential headers bypass anonymous proxy buckets without a session", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    mocks.getAuthRuntimeConfig.mockReturnValue({
      anonymousRateLimit: {
        enabled: true,
        readsPerMinute: 1,
        totalPerHour: 1,
        trustedProxyHops: 1,
        writesPerMinute: 1,
      },
      apiBaseUrl: "https://api.atlas.test",
      internalSecret: "internal-test-secret",
      localMode: false,
    });

    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    const requestInit = {
      headers: {
        "X-API-Key": "atlas_test_key",
        "X-Forwarded-For": "203.0.113.99",
      },
    };
    const first = await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities", requestInit),
    );
    const second = await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities", requestInit),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores spoof-prone provider IP headers when deriving proxy buckets", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    mocks.getAuthRuntimeConfig.mockReturnValue({
      anonymousRateLimit: {
        enabled: true,
        readsPerMinute: 1,
        totalPerHour: 100,
        trustedProxyHops: 1,
        writesPerMinute: 1,
      },
      apiBaseUrl: "https://api.atlas.test",
      internalSecret: "internal-test-secret",
      localMode: false,
    });

    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    const first = await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities", {
        headers: { "CF-Connecting-IP": "203.0.113.10" },
      }),
    );
    const blocked = await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities", {
        headers: { "CF-Connecting-IP": "198.51.100.20" },
      }),
    );

    expect(first.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not spend anonymous proxy buckets for authenticated sessions", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    mocks.getAuthRuntimeConfig.mockReturnValue({
      anonymousRateLimit: {
        enabled: true,
        readsPerMinute: 1,
        totalPerHour: 1,
        trustedProxyHops: 1,
        writesPerMinute: 1,
      },
      apiBaseUrl: "https://api.atlas.test",
      internalSecret: "internal-test-secret",
      localMode: false,
    });
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
    const requestInit = {
      headers: {
        Cookie: "session=secret",
        "X-Forwarded-For": "203.0.113.88",
      },
    };
    const first = await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities", requestInit),
    );
    const second = await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities", requestInit),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
