import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthRuntimeConfig: vi.fn(),
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

describe("proxyAtlasMcpRequest", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    mocks.getAuthRuntimeConfig.mockReset();
    global.fetch = vi.fn();
    mocks.getAuthRuntimeConfig.mockReturnValue({
      apiBaseUrl: "https://api.atlas.test",
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns 502 when the API proxy target is not configured", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({ apiBaseUrl: null });

    const { proxyAtlasMcpRequest } = await import("@/domains/access/server/mcp-proxy");
    const response = await proxyAtlasMcpRequest(new Request("https://atlas.test/mcp"));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error:
        "Atlas API proxy target is not configured. Set ATLAS_SERVER_API_PROXY_TARGET on the app server or configure public /mcp routing to the Atlas API.",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the Authorization header verbatim and streams the body without buffering", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response("upstream-body", {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    const { proxyAtlasMcpRequest } = await import("@/domains/access/server/mcp-proxy");
    const request = new Request("https://atlas.test/mcp", {
      body: '{"jsonrpc":"2.0","method":"initialize","id":1}',
      headers: {
        Accept: "application/json,text/event-stream",
        Authorization: "Bearer test-jwt",
        "Content-Type": "application/json",
        Host: "atlas.test",
      },
      method: "POST",
    });

    const response = await proxyAtlasMcpRequest(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.atlas.test/mcp");
    expect(init?.method).toBe("POST");
    expect((init as { duplex?: string } | undefined)?.duplex).toBe("half");
    expect(init?.body).toBe(request.body);

    const forwardedHeaders = new Headers(init?.headers);
    expect(forwardedHeaders.get("authorization")).toBe("Bearer test-jwt");
    expect(forwardedHeaders.get("accept")).toBe("application/json,text/event-stream");
    expect(forwardedHeaders.get("content-type")).toBe("application/json");
    expect(forwardedHeaders.get("host")).toBeNull();
    expect(forwardedHeaders.get("x-atlas-internal-secret")).toBeNull();
    expect(forwardedHeaders.get("x-atlas-actor-id")).toBeNull();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("upstream-body");
  });

  it("does not pass a body or duplex flag for GET requests", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(new Response("event-stream-body", { status: 200 }));

    const { proxyAtlasMcpRequest } = await import("@/domains/access/server/mcp-proxy");
    const request = new Request("https://atlas.test/mcp", {
      headers: { Authorization: "Bearer test-jwt" },
      method: "GET",
    });

    await proxyAtlasMcpRequest(request);

    const init = fetchMock.mock.calls[0]?.[1] as (RequestInit & { duplex?: string }) | undefined;
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.duplex).toBeUndefined();
  });

  it("returns 503 when the upstream API is unavailable", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockRejectedValue(new Error("network down"));

    const { proxyAtlasMcpRequest } = await import("@/domains/access/server/mcp-proxy");
    const response = await proxyAtlasMcpRequest(new Request("https://atlas.test/mcp"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Atlas API is unavailable." });
  });
});
