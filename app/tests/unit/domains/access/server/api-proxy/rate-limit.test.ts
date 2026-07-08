import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { baseRuntimeConfig, makeAuthenticatedSession, makeInternalAuthHeaders } from "./support";

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

describe("proxyAtlasApiRequest anonymous rate limiting", () => {
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
    mocks.loadAtlasSession.mockResolvedValue(makeAuthenticatedSession());
    mocks.createInternalAuthHeaders.mockReturnValue(makeInternalAuthHeaders());

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
