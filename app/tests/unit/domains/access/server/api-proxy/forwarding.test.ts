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

describe("proxyAtlasApiRequest forwarding", () => {
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

  it("forwards API requests and injects internal auth headers", async () => {
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
    mocks.loadAtlasSession.mockResolvedValue(makeAuthenticatedSession());
    mocks.createInternalAuthHeaders.mockReturnValue(makeInternalAuthHeaders());

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

  it("drops upstream content encoding after decoding the proxied response body", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-encoding": "br",
          "content-type": "application/json",
        },
        status: 200,
      }),
    );

    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    const response = await proxyAtlasApiRequest(new Request("https://atlas.test/api/entities"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("answers a HEAD request with the upstream headers and no body", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", etag: '"abc"' },
        status: 200,
      }),
    );

    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    const response = await proxyAtlasApiRequest(
      new Request("https://atlas.test/api/entities", { method: "HEAD" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(await response.text()).toBe("");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.atlas.test/api/entities",
      expect.objectContaining({ body: undefined, method: "HEAD" }),
    );
  });
});
