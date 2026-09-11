import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequest: vi.fn(),
  getRequestHeaders: vi.fn(),
  sanitizeBrowserSessionHeaders: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: mocks.getRequest,
  getRequestHeaders: mocks.getRequestHeaders,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  sanitizeBrowserSessionHeaders: mocks.sanitizeBrowserSessionHeaders,
}));

describe("getBrowserSessionHeaders", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getRequest.mockReset();
    mocks.getRequestHeaders.mockReset();
    mocks.sanitizeBrowserSessionHeaders.mockReset();
  });

  it("sanitizes the current request headers before exposing them to auth helpers", async () => {
    const requestHeaders = new Headers({
      cookie: "better-auth.session_token=test-token",
      "x-api-key": "atlas_secret_key",
    });
    const sanitizedHeaders = new Headers({
      cookie: "better-auth.session_token=test-token",
    });

    mocks.getRequestHeaders.mockReturnValue(requestHeaders);
    mocks.sanitizeBrowserSessionHeaders.mockReturnValue(sanitizedHeaders);

    const { getBrowserSessionHeaders } = await import("@/domains/access/server/request-headers");

    expect(getBrowserSessionHeaders()).toBe(sanitizedHeaders);
    expect(mocks.sanitizeBrowserSessionHeaders).toHaveBeenCalledWith(requestHeaders);
  });

  it("hands back the unsanitized request so callers can read the forwarding chain", async () => {
    const request = new Request("https://atlas.test/_serverFn/probe", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.7, 70.0.0.1" },
    });
    mocks.getRequest.mockReturnValue(request);

    const { getServerFnRequest } = await import("@/domains/access/server/request-headers");

    expect(getServerFnRequest()).toBe(request);
    expect(mocks.sanitizeBrowserSessionHeaders).not.toHaveBeenCalled();
  });
});
